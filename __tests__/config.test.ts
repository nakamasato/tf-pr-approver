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

  const withTargets = (target_paths: unknown): unknown => ({
    target_paths,
    rules: [{ name: 'x', when: { no_changes: true } }],
  })

  it('accepts target_paths with include and exclude', () => {
    const cfg = parseConfig(
      withTargets({ include: ['terraform/**', 'docs'], exclude: ['terraform/prod/**'] })
    )
    expect(cfg.target_paths).toEqual({
      include: ['terraform/**', 'docs'],
      exclude: ['terraform/prod/**'],
    })
  })

  it('accepts include on its own', () => {
    const cfg = parseConfig(withTargets({ include: ['terraform/**'] }))
    expect(cfg.target_paths).toEqual({ include: ['terraform/**'] })
  })

  it('accepts exclude on its own (nothing ends up in scope)', () => {
    // Valid config, useless gate: `paths.ts` puts no file in scope, so the
    // action can only ever skip. Fail-closed, so it is a warning, not an error.
    const cfg = parseConfig(withTargets({ exclude: ['app/**'] }))
    expect(cfg.target_paths).toEqual({ exclude: ['app/**'] })
    expect(cfg.target_paths?.include).toBeUndefined()
  })

  it('leaves target_paths undefined when omitted (scope gate disabled)', () => {
    const cfg = parseConfig({ rules: [{ name: 'x', when: { no_changes: true } }] })
    expect(cfg.target_paths).toBeUndefined()
  })

  it('rejects the old flat-array form', () => {
    expect(() => parseConfig(withTargets(['terraform/**']))).toThrow(/invalid config/)
  })

  it('rejects an empty target_paths object', () => {
    expect(() => parseConfig(withTargets({}))).toThrow(/must specify "include" and\/or "exclude"/)
  })

  it('rejects an empty include or exclude list', () => {
    expect(() => parseConfig(withTargets({ include: [] }))).toThrow(/invalid config/)
    expect(() => parseConfig(withTargets({ include: ['a'], exclude: [] }))).toThrow(/invalid config/)
  })

  it('rejects an unknown key under target_paths', () => {
    expect(() => parseConfig(withTargets({ include: ['a'], ignore: ['b'] }))).toThrow(
      /invalid config/
    )
  })

  it('rejects a negated pattern in include', () => {
    expect(() => parseConfig(withTargets({ include: ['terraform/**', '!docs/**'] }))).toThrow(
      /negated patterns/
    )
  })

  it('rejects a negated pattern in exclude (double negation widens the scope)', () => {
    expect(() =>
      parseConfig(withTargets({ include: ['terraform/**'], exclude: ['!docs/**'] }))
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
