import { describe, expect, it } from 'vitest'
import { Rule } from '../src/config'
import { BUILT_IN_DEFAULT_RULES, resolveRuleSet, unusedRuleMapKeys } from '../src/rule-map'

/** Rule sets are told apart by the rule name; the conditions are irrelevant here. */
const rules = (label: string): Rule[] => [{ name: label, when: { no_changes: true } }]

describe('resolveRuleSet', () => {
  it('prefers a key that matches the name exactly', () => {
    const r = resolveRuleSet('sandbox', { ruleMap: { sandbox: rules('exact') } })
    expect(r).toEqual({ ruleSet: 'sandbox', rules: rules('exact') })
  })

  it('falls back to a glob key', () => {
    const r = resolveRuleSet('api-prod', { ruleMap: { '*-prod': rules('glob') } })
    expect(r).toEqual({ ruleSet: '*-prod', rules: rules('glob') })
  })

  it('lets an exact key beat a glob key that also matches', () => {
    const r = resolveRuleSet('api-prod', {
      ruleMap: { 'api-prod': rules('exact'), '*-prod': rules('glob') },
    })
    expect(r.ruleSet).toBe('api-prod')
  })

  it('throws when two glob keys match and no exact key does', () => {
    // Deliberately not resolved by specificity: an implicit winner here would
    // decide which plans get the permissive rules.
    expect(() =>
      resolveRuleSet('api-prod', { ruleMap: { '*-prod': rules('a'), 'api-*': rules('b') } })
    ).toThrow(/more than one "tfplan_rule_map" pattern/)
  })

  it('uses the explicit default for an unlisted name', () => {
    const r = resolveRuleSet('other', {
      ruleMap: { sandbox: rules('sandbox'), default: rules('default') },
    })
    expect(r).toEqual({ ruleSet: 'default', rules: rules('default') })
  })

  it('uses the explicit default for an unnamed plan', () => {
    const r = resolveRuleSet(null, { ruleMap: { sandbox: rules('sandbox'), default: rules('d') } })
    expect(r.ruleSet).toBe('default')
  })

  it('never selects the reserved "default" key as an exact or glob match', () => {
    // A plan literally named "default" still lands in the default bucket, which
    // is the same rules — but the bucket label must stay honest.
    const r = resolveRuleSet('default', { ruleMap: { default: rules('d') } })
    expect(r.ruleSet).toBe('default')
  })

  it('uses top-level rules as the default bucket', () => {
    const r = resolveRuleSet('other', {
      ruleMap: { sandbox: rules('sandbox') },
      rules: rules('top'),
    })
    expect(r).toEqual({ ruleSet: 'rules', rules: rules('top') })
  })

  it('prefers tfplan_rule_map.default over top-level rules', () => {
    // config.ts rejects this combination; the pure function stays deterministic.
    const r = resolveRuleSet('other', { ruleMap: { default: rules('map') }, rules: rules('top') })
    expect(r.ruleSet).toBe('default')
  })

  it('falls back to the built-in default when nothing is configured', () => {
    expect(resolveRuleSet('other', {})).toEqual({
      ruleSet: 'built-in default',
      rules: BUILT_IN_DEFAULT_RULES,
    })
    expect(BUILT_IN_DEFAULT_RULES).toEqual([{ name: 'no-changes', when: { no_changes: true } }])
  })

  it('does not treat inherited Object properties as rule map keys', () => {
    // `ruleMap["constructor"]` would otherwise return a function and be truthy.
    expect(resolveRuleSet('constructor', { ruleMap: {} }).ruleSet).toBe('built-in default')
    expect(resolveRuleSet('toString', { ruleMap: {} }).ruleSet).toBe('built-in default')
  })
})

describe('unusedRuleMapKeys', () => {
  it('reports keys that selected no plan', () => {
    expect(unusedRuleMapKeys({ sandbox: rules('a'), prod: rules('b') }, ['sandbox'])).toEqual([
      'prod',
    ])
  })

  it('never reports the reserved default key', () => {
    expect(unusedRuleMapKeys({ default: rules('a') }, [])).toEqual([])
  })

  it('returns nothing when there is no rule map', () => {
    expect(unusedRuleMapKeys(undefined, [])).toEqual([])
  })
})
