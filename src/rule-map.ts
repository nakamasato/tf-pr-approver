/**
 * Selects which rule set applies to a plan, from the plan's name and the
 * config's `tfplan_rule_map`.
 *
 * Resolution order, per plan:
 *   1. a key matching the name exactly
 *   2. a glob key — exactly one, or it is an error
 *   3. the default bucket (`tfplan_rule_map.default`, else top-level `rules`)
 *   4. the built-in default
 *
 * Step 4 is what makes an incomplete configuration fail closed: an unlisted
 * name lands on the most conservative useful rule instead of on a hole.
 *
 * Pure logic, no I/O, so it can be unit-tested exhaustively.
 */
import { minimatch } from 'minimatch'
import { Rule } from './config'

/** Reserved key naming the fallback bucket; never matched as a name or a glob. */
export const DEFAULT_KEY = 'default'

/** Bucket label reported when the top-level `rules` list is used. */
const TOP_LEVEL_RULES_LABEL = 'rules'

/** Bucket label reported when nothing at all is configured. Also used by `summary.ts`. */
export const BUILT_IN_LABEL = 'built-in default'

/**
 * Applied when neither `tfplan_rule_map.default` nor `rules` is configured.
 * `no_changes` is the most conservative rule that still approves anything.
 */
export const BUILT_IN_DEFAULT_RULES: Rule[] = [{ name: 'no-changes', when: { no_changes: true } }]

export type RuleMap = Record<string, Rule[]>

export interface RuleSetResolution {
  /** The selected bucket: a map key, "default", "rules", or "built-in default". */
  ruleSet: string
  rules: Rule[]
}

export interface RuleSources {
  ruleMap?: RuleMap
  /** Top-level `rules`: the same bucket as `tfplan_rule_map.default`. */
  rules?: Rule[]
}

/** Characters that make a key a glob rather than a literal name. */
const GLOB_MAGIC = /[*?[\]{}!()]/

/**
 * Same `nonegate` reasoning as `paths.ts`: a leading "!" must not turn a narrow
 * key into one that matches almost every name. `config.ts` rejects such keys;
 * this keeps the pure function safe on its own too.
 */
const MINIMATCH_OPTIONS = { nonegate: true } as const

export function resolveRuleSet(name: string | null, sources: RuleSources): RuleSetResolution {
  const ruleMap = sources.ruleMap ?? {}

  // `Object.hasOwn` rather than a truthiness check: a plan named "constructor"
  // or "toString" would otherwise pick up an inherited Object property.
  if (name !== null && name !== DEFAULT_KEY) {
    if (Object.hasOwn(ruleMap, name)) {
      return { ruleSet: name, rules: ruleMap[name] }
    }
    const globKeys = Object.keys(ruleMap).filter(
      (key) =>
        key !== DEFAULT_KEY && GLOB_MAGIC.test(key) && minimatch(name, key, MINIMATCH_OPTIONS)
    )
    if (globKeys.length > 1) {
      throw new Error(
        `plan "${name}" is matched by more than one "tfplan_rule_map" pattern ` +
          `(${globKeys.map((k) => `"${k}"`).join(', ')}); make the patterns disjoint, or add a ` +
          'key matching the name exactly'
      )
    }
    if (globKeys.length === 1) {
      return { ruleSet: globKeys[0], rules: ruleMap[globKeys[0]] }
    }
  }

  if (Object.hasOwn(ruleMap, DEFAULT_KEY)) {
    return { ruleSet: DEFAULT_KEY, rules: ruleMap[DEFAULT_KEY] }
  }
  if (sources.rules) {
    return { ruleSet: TOP_LEVEL_RULES_LABEL, rules: sources.rules }
  }
  return { ruleSet: BUILT_IN_LABEL, rules: BUILT_IN_DEFAULT_RULES }
}

/**
 * Keys that selected no plan in this run. Usually a typo in a `plan-files`
 * name, but indistinguishable from a stack that was simply not planned in this
 * PR — so the caller warns rather than fails. It fails in the safe direction
 * anyway: the intended rules go unused and the plan falls through to a
 * stricter bucket.
 */
export function unusedRuleMapKeys(ruleMap: RuleMap | undefined, usedRuleSets: string[]): string[] {
  if (!ruleMap) return []
  const used = new Set(usedRuleSets)
  return Object.keys(ruleMap).filter((key) => key !== DEFAULT_KEY && !used.has(key))
}
