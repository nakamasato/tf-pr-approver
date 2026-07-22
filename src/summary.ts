/**
 * Renders the per-plan evaluation result to the GitHub Actions Job Summary.
 */
import * as core from '@actions/core'
import { PlanEvaluation } from './evaluate'

export interface PlanResult {
  file: string
  evaluation: PlanEvaluation
}

export async function writeSummary(results: PlanResult[], approved: boolean): Promise<void> {
  const summary = core.summary.addHeading('tf-pr-approver', 2)

  summary.addRaw(
    approved
      ? '✅ **Approved** — every plan matched a safe-change rule.'
      : '⏭️ **Skipped** — at least one plan did not match any rule. Human review required.',
    true
  )

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

  for (const r of results) {
    if (r.evaluation.matched) continue
    const reasons = r.evaluation.ruleEvaluations
      .map((e) => `- \`${e.rule}\`: ${e.reason ?? 'n/a'}`)
      .join('\n')
    summary.addDetails(`Why "${r.file}" did not match any rule`, `\n\n${reasons}\n`)
  }

  await summary.write()
}
