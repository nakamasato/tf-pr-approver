/**
 * Renders the scope check and the per-plan evaluation result to the
 * GitHub Actions Job Summary.
 */
import * as core from '@actions/core'
import { PlanEvaluation } from './evaluate'
import { PathCheckResult } from './paths'

export interface PlanResult {
  file: string
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
    summary.addList(listed.map((f) => `<code>${f}</code>`))
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
          { data: 'Result', header: true },
          { data: 'Matched rule', header: true },
        ],
        ...results.map((r) => [
          r.file,
          r.evaluation.matched ? '✅ matched' : '❌ no match',
          r.evaluation.matchedRule ?? '-',
        ]),
      ])
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
