import { describe, expect, it } from 'vitest'
import { buildApproveBody } from '../src/approve-body'
import { PlanResult } from '../src/summary'

function result(overrides: Partial<PlanResult>): PlanResult {
  return {
    file: 'tfplans/prod/tfplan.json',
    name: 'prod',
    ruleSet: 'prod',
    evaluation: { matched: true, matchedRule: 'no changes', ruleEvaluations: [] },
    ...overrides,
  }
}

describe('buildApproveBody', () => {
  it('appends one table row per plan with the rule that matched', () => {
    const body = buildApproveBody('approved', [
      result({}),
      result({
        file: 'tfplans/dev/tfplan.json',
        name: null,
        ruleSet: 'default',
        evaluation: { matched: true, matchedRule: 'update only', ruleEvaluations: [] },
      }),
    ])

    expect(body).toBe(
      [
        'approved',
        '',
        '| Plan | Rule set | Matched rule |',
        '| --- | --- | --- |',
        '| `tfplans/prod/tfplan.json` (prod) | `prod` | `no changes` |',
        '| `tfplans/dev/tfplan.json` | `default` | `update only` |',
      ].join('\n')
    )
  })

  it('explains when no plan was evaluated', () => {
    expect(buildApproveBody('approved', [])).toContain('No plan was evaluated')
  })

  it('escapes pipes and newlines so a plan name cannot break the table', () => {
    const body = buildApproveBody('approved', [result({ name: 'a|b\nc' })])
    expect(body).toContain('(a\\|b c)')
  })
})
