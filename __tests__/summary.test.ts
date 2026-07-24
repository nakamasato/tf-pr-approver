import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@actions/core')

import * as core from '@actions/core'
import { PlanResult, writeSummary } from '../src/summary'

/** A chainable stub standing in for `core.summary`. */
function stubSummary(): { addTable: ReturnType<typeof vi.fn>; addRaw: ReturnType<typeof vi.fn> } {
  const calls = { addTable: vi.fn(), addRaw: vi.fn() }
  const chain = {
    addHeading: vi.fn(() => chain),
    addRaw: vi.fn((...args: unknown[]) => {
      calls.addRaw(...args)
      return chain
    }),
    addList: vi.fn(() => chain),
    addDetails: vi.fn(() => chain),
    addTable: vi.fn((...args: unknown[]) => {
      calls.addTable(...args)
      return chain
    }),
    write: vi.fn(async () => chain),
  }
  Object.defineProperty(core, 'summary', { value: chain, configurable: true })
  return calls
}

const result = (over: Partial<PlanResult> = {}): PlanResult => ({
  file: 'plans/a.json',
  name: 'sandbox',
  ruleSet: 'sandbox',
  evaluation: { matched: true, matchedRule: 'anything', ruleEvaluations: [] },
  ...over,
})

let calls: ReturnType<typeof stubSummary>

beforeEach(() => {
  vi.clearAllMocks()
  calls = stubSummary()
})

describe('writeSummary', () => {
  it('renders a name and rule set column for every plan', async () => {
    await writeSummary({ pathCheck: null, results: [result()], approved: true })

    const [rows] = calls.addTable.mock.calls[0] as [Array<Array<unknown>>]
    expect(rows[0]).toEqual([
      { data: 'Plan file', header: true },
      { data: 'Name', header: true },
      { data: 'Rule set', header: true },
      { data: 'Result', header: true },
      { data: 'Matched rule', header: true },
    ])
    expect(rows[1]).toEqual(['plans/a.json', 'sandbox', 'sandbox', '✅ matched', 'anything'])
  })

  it('shows an unnamed plan with a placeholder rather than an empty cell', async () => {
    await writeSummary({
      pathCheck: null,
      results: [result({ name: null, ruleSet: 'built-in default' })],
      approved: true,
    })

    const [rows] = calls.addTable.mock.calls[0] as [Array<Array<unknown>>]
    expect(rows[1]).toEqual(['plans/a.json', '-', 'built-in default', '✅ matched', 'anything'])
  })

  it('warns when a plan fell through to the built-in default', async () => {
    // Usually means a name was never wired up in `plan-files`.
    await writeSummary({
      pathCheck: null,
      results: [result({ name: null, ruleSet: 'built-in default' })],
      approved: true,
    })

    const raw = calls.addRaw.mock.calls.map((c) => String(c[0])).join('\n')
    expect(raw).toContain('built-in default')
  })
})
