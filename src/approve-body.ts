/**
 * Builds the body of the approving review: the caller-supplied message
 * followed by a table of which rule approved each plan, so a reviewer can
 * audit the decision from the PR without opening the workflow logs.
 */
import { PlanResult } from './summary'

/**
 * Pipes and newlines would break the table row; plan names and file paths
 * come from the caller's inputs, so escape rather than trust them.
 */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function buildApproveBody(message: string, results: PlanResult[]): string {
  if (results.length === 0) {
    return `${message}\n\n_No plan was evaluated; approved on the scope check alone._`
  }
  const rows = results.map((r) => {
    const plan = r.name !== null ? `\`${cell(r.file)}\` (${cell(r.name)})` : `\`${cell(r.file)}\``
    return `| ${plan} | \`${cell(r.ruleSet)}\` | \`${cell(r.evaluation.matchedRule ?? '-')}\` |`
  })
  return [message, '', '| Plan | Rule set | Matched rule |', '| --- | --- | --- |', ...rows].join(
    '\n'
  )
}
