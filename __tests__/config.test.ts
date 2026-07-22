import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config'

describe('parseConfig', () => {
  it('accepts a valid config', () => {
    const cfg = parseConfig({
      rules: [
        { name: 'no-changes', when: { no_changes: true } },
        {
          name: 'safe-updates',
          when: { allowed_actions: ['update'], denied_actions: ['delete'] },
        },
      ],
    })
    expect(cfg.rules).toHaveLength(2)
  })

  it('rejects config with no rules', () => {
    expect(() => parseConfig({ rules: [] })).toThrow(/invalid config/)
  })

  it('rejects a rule with an empty "when"', () => {
    expect(() => parseConfig({ rules: [{ name: 'x', when: {} }] })).toThrow(
      /at least one condition/
    )
  })

  it('rejects unknown fields (strict)', () => {
    expect(() =>
      parseConfig({ rules: [{ name: 'x', when: { no_changes: true }, extra: 1 }] })
    ).toThrow(/invalid config/)
  })

  it('rejects an unknown action value', () => {
    expect(() =>
      parseConfig({ rules: [{ name: 'x', when: { allowed_actions: ['destroy'] } }] })
    ).toThrow(/invalid config/)
  })

  it('rejects a missing rule name', () => {
    expect(() => parseConfig({ rules: [{ when: { no_changes: true } }] })).toThrow(/invalid config/)
  })
})
