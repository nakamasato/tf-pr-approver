/**
 * Entry point / orchestration.
 *
 * Flow:
 *   1. load + validate config
 *   2. scope gate: the PR must not change anything outside `target_paths`
 *   3. resolve plan files (glob / newline list)
 *   4. evaluate each plan against the rules
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

async function resolvePlanFiles(input: string): Promise<string[]> {
  const globber = await glob.create(input, { matchDirectories: false })
  const files = await globber.glob()
  return Array.from(new Set(files))
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

    const octokit = github.getOctokit(token)
    const { owner, repo } = github.context.repo
    const pullNumber = getPullNumber()

    // --- 1. scope gate -----------------------------------------------------
    let pathCheck: PathCheckResult | null = null
    if (config.target_paths) {
      const changedFiles = await listChangedFiles({ octokit, owner, repo, pullNumber })
      pathCheck = checkChangedFiles(changedFiles, config.target_paths)
      core.info(
        `Scope check: ${changedFiles.length} changed file(s) against ` +
          `${config.target_paths.length} target path(s) — ` +
          (pathCheck.matched
            ? 'all in scope.'
            : `${pathCheck.outOfScopeFiles.length} out of scope.`)
      )
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
      core.setOutput('out-of-scope-files', JSON.stringify(pathCheck.outOfScopeFiles))
      await writeSummary({ pathCheck, results: [], approved: false })
      return
    }

    // --- 2. plan evaluation ------------------------------------------------
    const planFiles = await resolvePlanFiles(planInput)
    if (planFiles.length === 0 && !allowEmptyPlans) {
      throw new Error(
        `no plan files matched: ${planInput} (set "allow-empty-plans: true" if a PR in scope ` +
          'legitimately produces no plan, e.g. a docs-only change)'
      )
    }
    core.info(`Evaluating ${planFiles.length} plan file(s) against ${config.rules.length} rule(s).`)

    const results: PlanResult[] = planFiles.map((file) => {
      const content = fs.readFileSync(file, 'utf8')
      const plan = parsePlan(content)
      const evaluation = evaluatePlan(plan, config.rules)
      core.info(
        `  ${file}: ${evaluation.matched ? `matched "${evaluation.matchedRule}"` : 'no match'}`
      )
      return { file, evaluation }
    })

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
    await writeSummary({ pathCheck, results, approved })
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

run()
