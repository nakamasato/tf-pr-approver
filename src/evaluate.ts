/**
 * Pure rule-evaluation logic. Given a parsed terraform plan and the configured
 * rules, decide whether the plan is "safe" (matches at least one rule).
 *
 * This module has no side effects and no I/O so it can be unit-tested exhaustively.
 */
import { Conditions, Rule } from './config'
import { ResourceChange, TerraformPlan, TfAction } from './plan'

/** Actions that do not represent an actual change to infrastructure. */
const NON_CHANGE_ACTIONS: ReadonlySet<TfAction> = new Set<TfAction>(['no-op', 'read'])

function isEffectiveChange(rc: ResourceChange): boolean {
  return rc.change.actions.some((a) => !NON_CHANGE_ACTIONS.has(a))
}

export interface RuleEvaluation {
  rule: string
  matched: boolean
  /** Populated when the rule did not match, explaining the first failing condition. */
  reason?: string
}

export interface PlanEvaluation {
  matched: boolean
  matchedRule: string | null
  ruleEvaluations: RuleEvaluation[]
}

function evaluateConditions(
  plan: TerraformPlan,
  when: Conditions
): { matched: boolean; reason?: string } {
  const changes = plan.resource_changes ?? []
  const effective = changes.filter(isEffectiveChange)

  if (when.no_changes === true && effective.length > 0) {
    return {
      matched: false,
      reason: `expected no changes but ${effective.length} resource(s) would change`,
    }
  }

  if (when.denied_actions) {
    const denied = new Set<TfAction>(when.denied_actions)
    for (const rc of changes) {
      const bad = rc.change.actions.find((a) => denied.has(a))
      if (bad) {
        return { matched: false, reason: `${rc.address} has denied action "${bad}"` }
      }
    }
  }

  if (when.allowed_actions) {
    // no-op / read are always permitted; a resource that isn't changing shouldn't block a rule.
    const allowed = new Set<TfAction>([...when.allowed_actions, 'no-op', 'read'])
    for (const rc of changes) {
      const bad = rc.change.actions.find((a) => !allowed.has(a))
      if (bad) {
        return {
          matched: false,
          reason: `${rc.address} has action "${bad}" not in allowed_actions`,
        }
      }
    }
  }

  if (when.allowed_resource_types) {
    const allowed = new Set(when.allowed_resource_types)
    for (const rc of effective) {
      if (!allowed.has(rc.type)) {
        return {
          matched: false,
          reason: `${rc.address} type "${rc.type}" not in allowed_resource_types`,
        }
      }
    }
  }

  if (when.denied_resource_types) {
    const denied = new Set(when.denied_resource_types)
    for (const rc of effective) {
      if (denied.has(rc.type)) {
        return {
          matched: false,
          reason: `${rc.address} type "${rc.type}" is in denied_resource_types`,
        }
      }
    }
  }

  return { matched: true }
}

/**
 * Evaluate a plan against the rule list. Rules are OR'd: the first rule whose
 * conditions all hold wins. Returns the matched rule name (or null) plus a
 * per-rule breakdown for reporting.
 */
export function evaluatePlan(plan: TerraformPlan, rules: Rule[]): PlanEvaluation {
  const ruleEvaluations: RuleEvaluation[] = []
  for (const rule of rules) {
    const res = evaluateConditions(plan, rule.when)
    ruleEvaluations.push({ rule: rule.name, matched: res.matched, reason: res.reason })
    if (res.matched) {
      return { matched: true, matchedRule: rule.name, ruleEvaluations }
    }
  }
  return { matched: false, matchedRule: null, ruleEvaluations }
}
