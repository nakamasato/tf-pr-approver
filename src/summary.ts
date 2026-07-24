/**
 * Renders the scope check and the per-plan evaluation result to the
 * GitHub Actions Job Summary.
 */
import * as core from '@actions/core'
import { PlanEvaluation } from './evaluate'
import { PathCheckResult } from './paths'
import { BUILT_IN_LABEL } from './rule-map'

export interface PlanResult {
  file: string
  /** null when the plan came from a bare glob rather than a `name=glob` entry. */
  name: string | null
  /** Which `tfplan_rule_map` bucket was applied; see `rule-map.ts`. */
  ruleSet: string
  evaluation: PlanEvaluation
}

export interface SummaryInput {
  /** null when the config declares no `target_paths` (gate disabled). */
  pathCheck: PathCheckResult | null
  results: PlanResult[]
  approved: boolean
}

/** Keep the summary readable when a PR touches a large number of files. */
const MAX_LISTED_FILES = 20

/** File paths are attacker-controlled; escape before embedding them in HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function writeSummary(input: SummaryInput): Promise<void> {
  const { pathCheck, results, approved } = input
  const outOfScope = pathCheck && !pathCheck.matched

  const summary = core.summary.addHeading('tf-pr-approver', 2)

  let verdict: string
  if (approved) {
    verdict =
      '✅ **Approved** — the PR stays within scope and every plan matched a safe-change rule.'
  } else if (outOfScope) {
    verdict = '⏭️ **Skipped** — the PR changes files outside `target_paths`. Human review required.'
  } else {
    verdict = '⏭️ **Skipped** — at least one plan did not match any rule. Human review required.'
  }
  summary.addRaw(verdict, true)

  summary.addHeading('Scope check', 3)
  if (!pathCheck) {
    summary.addRaw(
      '⚠️ No `target_paths` configured — every changed file is treated as in scope.',
      true
    )
  } else if (pathCheck.matched) {
    summary.addRaw('✅ Every changed file is inside `target_paths`.', true)
  } else {
    const listed = pathCheck.outOfScopeFiles.slice(0, MAX_LISTED_FILES)
    const rest = pathCheck.outOfScopeFiles.length - listed.length
    summary.addRaw(
      `❌ ${pathCheck.outOfScopeFiles.length} changed file(s) outside \`target_paths\`:`,
      true
    )
    summary.addList(listed.map((f) => `<code>${escapeHtml(f)}</code>`))
    if (rest > 0) {
      summary.addRaw(`…and ${rest} more.`, true)
    }
  }

  if (!outOfScope) {
    summary.addHeading('Plan evaluation', 3)
    if (results.length === 0) {
      summary.addRaw('No plan files to evaluate.', true)
    } else {
      summary.addTable([
        [
          { data: 'Plan file', header: true },
          { data: 'Name', header: true },
          { data: 'Rule set', header: true },
          { data: 'Result', header: true },
          { data: 'Matched rule', header: true },
        ],
        ...results.map((r) => [
          escapeHtml(r.file),
          r.name !== null ? escapeHtml(r.name) : '-',
          escapeHtml(r.ruleSet),
          r.evaluation.matched ? '✅ matched' : '❌ no match',
          r.evaluation.matchedRule ?? '-',
        ]),
      ])

      // Landing on the built-in default nearly always means a name was never
      // wired up, so the plan was judged by stricter rules than intended.
      const builtIn = results.filter((r) => r.ruleSet === BUILT_IN_LABEL)
      if (builtIn.length > 0) {
        summary.addRaw(
          `⚠️ ${builtIn.length} plan(s) were evaluated against the **built-in default** ` +
            '(`no_changes` only) because no rule set selected them.',
          true
        )
      }
    }

    for (const r of results) {
      if (r.evaluation.matched) continue
      const reasons = r.evaluation.ruleEvaluations
        .map((e) => `- \`${e.rule}\`: ${e.reason ?? 'n/a'}`)
        .join('\n')
      summary.addDetails(`Why "${r.file}" did not match any rule`, `\n\n${reasons}\n`)
    }
  }

  await summary.write()
}
