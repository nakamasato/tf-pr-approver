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

  it('accepts target_paths', () => {
    const cfg = parseConfig({
      target_paths: ['terraform/**', 'docs'],
      rules: [{ name: 'no-changes', when: { no_changes: true } }],
    })
    expect(cfg.target_paths).toEqual(['terraform/**', 'docs'])
  })

  it('leaves target_paths undefined when omitted (scope gate disabled)', () => {
    const cfg = parseConfig({ rules: [{ name: 'x', when: { no_changes: true } }] })
    expect(cfg.target_paths).toBeUndefined()
  })

  it('rejects an empty target_paths list', () => {
    expect(() =>
      parseConfig({ target_paths: [], rules: [{ name: 'x', when: { no_changes: true } }] })
    ).toThrow(/invalid config/)
  })

  it('rejects a negated target_paths pattern', () => {
    expect(() =>
      parseConfig({
        target_paths: ['terraform/**', '!docs/**'],
        rules: [{ name: 'x', when: { no_changes: true } }],
      })
    ).toThrow(/negated patterns/)
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
