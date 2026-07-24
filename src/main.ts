/**
 * Orchestration. The runtime entry point is `src/index.ts`, which just calls
 * `run()`; keeping the invocation out of this module lets the tests import and
 * drive `run()` directly.
 *
 * Flow:
 *   1. load + validate config
 *   2. scope gate: the PR must not change anything outside `target_paths`
 *   3. resolve plan files (glob / newline list)
 *   4. evaluate each plan against the rule set its name selects
 *   5. approve the PR only if the gate passed and every plan matched a rule
 *   6. write outputs + job summary
 *
 * The scope gate comes first and short-circuits: an out-of-scope change is
 * never auto-approved regardless of what the plan says.
 *
 * Error policy: "conditions not met" is a normal (skip) outcome; malformed
 * config / input / plan is a failure (core.setFailed).
 */
import * as fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import * as glob from '@actions/glob'
import { loadConfig } from './config'
import { listChangedFiles } from './changed-files'
import { checkChangedFiles, PathCheckResult } from './paths'
import { parsePlan } from './plan'
import { evaluatePlan } from './evaluate'
import { approvePullRequest } from './approve'
import { PlanResult, writeSummary } from './summary'
import { parsePlanFilesInput, PlanFileEntry } from './plan-files'
import { resolveRuleSet, unusedRuleMapKeys } from './rule-map'

interface ResolvedPlanFile {
  file: string
  /** null when the file came from a bare glob rather than a `name=glob` entry. */
  name: string | null
}

async function resolvePlanFiles(entries: PlanFileEntry[]): Promise<ResolvedPlanFile[]> {
  const byFile = new Map<string, ResolvedPlanFile>()

  for (const entry of entries) {
    const globber = await glob.create(entry.pattern, { matchDirectories: false })
    const files = Array.from(new Set(await globber.glob()))

    // Matching nothing is normal — only the stacks a PR touches produce a plan.
    // Matching several files is not: the outputs and the summary key per-plan
    // results by name, so a name has to identify exactly one plan.
    if (entry.name !== null && files.length > 1) {
      throw new Error(
        `plan name "${entry.name}" matched ${files.length} files (${files.join(', ')}); ` +
          'a name must identify exactly one plan'
      )
    }
    if (entry.name !== null && files.length === 0) {
      core.info(`  ${entry.name}: no plan file matched ${entry.pattern} (stack not planned)`)
    }

    for (const file of files) {
      const existing = byFile.get(file)
      if (!existing) {
        byFile.set(file, { file, name: entry.name })
        continue
      }
      // A file reachable from both a named and a bare entry keeps the name:
      // the named entry is the more specific statement of intent, and the
      // result must not depend on which line happens to come first.
      if (existing.name === null && entry.name !== null) {
        existing.name = entry.name
      }
    }
  }

  return Array.from(byFile.values())
}

function getPullNumber(): number {
  const raw = core.getInput('pull-request-number')
  if (raw) {
    const n = Number.parseInt(raw, 10)
    if (Number.isNaN(n)) {
      throw new Error(`invalid pull-request-number: "${raw}"`)
    }
    return n
  }
  const pr = github.context.payload.pull_request
  if (!pr) {
    throw new Error(
      'could not determine the pull request number from the event context; set the "pull-request-number" input'
    )
  }
  return pr.number
}

export async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true })
    const planInput = core.getInput('plan-files', { required: true })
    const configPath = core.getInput('config')
    const approveMessage = core.getInput('approve-message')
    const allowEmptyPlans = core.getBooleanInput('allow-empty-plans')

    const config = loadConfig(configPath)

    // Without `target_paths` there is no scope gate, and with `allow-empty-plans`
    // an empty plan set evaluates to `[].every(...) === true`. Together they would
    // approve *any* PR unconditionally, so refuse the combination up front.
    if (allowEmptyPlans && !config.target_paths) {
      throw new Error(
        '"allow-empty-plans: true" requires "target_paths" in the config: without a scope ' +
          'check, a PR that produces no plan would be approved unconditionally'
      )
    }

    const octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo
    const pullNumber = getPullNumber()

    // --- 1. scope gate -----------------------------------------------------
    let pathCheck: PathCheckResult | null = null
    if (config.target_paths) {
      const changedFiles = await listChangedFiles({ octokit, owner, repo, pullNumber })
      const { include = [], exclude = [] } = config.target_paths
      pathCheck = checkChangedFiles(changedFiles, config.target_paths)
      core.info(
        `Scope check: ${changedFiles.length} changed file(s) against ` +
          `${include.length} include / ${exclude.length} exclude pattern(s) — ` +
          (pathCheck.matched
            ? 'all in scope.'
            : `${pathCheck.outOfScopeFiles.length} out of scope.`)
      )
      // Nothing can ever be in scope, so the gate can only skip. Cheap to
      // misconfigure (an `exclude` written without an `include`), and the
      // symptom otherwise looks like a normal skip.
      if (include.length === 0) {
        core.warning(
          '"target_paths" declares no "include" patterns: no file is in scope, so this PR ' +
            'can never be approved. Add the paths you want to allow.'
        )
      }
      for (const f of pathCheck.outOfScopeFiles) {
        core.info(`  out of scope: ${f}`)
      }
    } else {
      core.warning(
        'config has no "target_paths": every changed file is treated as in scope, so a PR ' +
          'that also changes non-terraform files can still be auto-approved.'
      )
    }

    if (pathCheck && !pathCheck.matched) {
      core.info(
        'PR changes files outside "target_paths"; skipping approval (human review required).'
      )
      core.setOutput('approved', 'false')
      core.setOutput('matched-rules', '{}')
      core.setOutput('plan-results', '[]')
      core.setOutput('out-of-scope-files', JSON.stringify(pathCheck.outOfScopeFiles))
      await writeSummary({ pathCheck, results: [], approved: false })
      return
    }

    // --- 2. plan evaluation ------------------------------------------------
    const planFiles = await resolvePlanFiles(parsePlanFilesInput(planInput))
    if (planFiles.length === 0 && !allowEmptyPlans) {
      throw new Error(
        `no plan files matched: ${planInput} (set "allow-empty-plans: true" if a PR in scope ` +
          'legitimately produces no plan, e.g. a docs-only change)'
      )
    }
    if (planFiles.length === 0) {
      // The scope check is the only thing standing between this PR and an
      // approval — say so loudly, because a lost artifact or a typo in
      // `plan-files` looks exactly like a legitimate docs-only change.
      core.warning(
        `no plan files matched: ${planInput} — no plan was evaluated; approving on the ` +
          'scope check alone. Verify that the plan job actually produced the plan JSON.'
      )
    }
    core.info(`Evaluating ${planFiles.length} plan file(s).`)

    const results: PlanResult[] = planFiles.map(({ file, name }) => {
      const content = fs.readFileSync(file, 'utf8')
      const plan = parsePlan(content)
      const { ruleSet, rules } = resolveRuleSet(name, {
        ruleMap: config.tfplan_rule_map,
        rules: config.rules,
      })
      const evaluation = evaluatePlan(plan, rules)
      core.info(
        `  ${file} [${name ?? 'unnamed'}] against "${ruleSet}": ` +
          (evaluation.matched ? `matched "${evaluation.matchedRule}"` : 'no match')
      )
      return { file, name, ruleSet, evaluation }
    })

    for (const key of unusedRuleMapKeys(
      config.tfplan_rule_map,
      results.map((r) => r.ruleSet)
    )) {
      core.warning(
        `"tfplan_rule_map" key "${key}" matched no plan in this run — check the "plan-files" ` +
          'names if that stack was expected to be evaluated.'
      )
    }

    const approved = results.every((r) => r.evaluation.matched)

    const matchedRules: Record<string, string | null> = {}
    for (const r of results) {
      matchedRules[r.file] = r.evaluation.matchedRule
    }

    // --- 3. approval -------------------------------------------------------
    if (approved) {
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      })
      await approvePullRequest({
        octokit,
        owner,
        repo,
        pullNumber,
        headSha: pr.head.sha,
        body: approveMessage,
      })
    } else {
      core.info('Not all plans matched a rule; skipping approval (human review required).')
    }

    core.setOutput('approved', String(approved))
    core.setOutput('matched-rules', JSON.stringify(matchedRules))
    core.setOutput('out-of-scope-files', '[]')
    core.setOutput(
      'plan-results',
      JSON.stringify(
        results.map((r) => ({
          file: r.file,
          name: r.name,
          ruleSet: r.ruleSet,
          rule: r.evaluation.matchedRule,
          matched: r.evaluation.matched,
        }))
      )
    )
    await writeSummary({ pathCheck, results, approved })
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
