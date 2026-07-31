/**
 * Parses the `plan-files` action input into entries.
 *
 * Each newline-separated line is either a bare glob (the original form) or
 * `name=glob`, which binds a name to the plan that glob produces so
 * `tfplan_rule_map` can select a rule set per plan.
 *
 * Pure: no globbing and no filesystem access, so it can be unit-tested
 * exhaustively.
 */

export interface PlanFileEntry {
  /** null for a bare glob line: those plans fall into the default rule set. */
  name: string | null
  pattern: string
}

/**
 * Names are looked up as `tfplan_rule_map` keys and matched against the glob
 * keys there. Allowing glob metacharacters in a name would make that matching
 * ambiguous in both directions at once, so keep names literal.
 */
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/

export function parsePlanFilesInput(input: string): PlanFileEntry[] {
  const entries: PlanFileEntry[] = []
  const seen = new Set<string>()

  for (const raw of input.split('\n')) {
    const line = raw.trim()
    if (line === '') continue

    const eq = line.indexOf('=')
    // A name can never contain "/", so a "=" appearing after one belongs to the
    // path, not to a `name=glob` binding. That keeps a pre-existing bare glob
    // such as `plans/a=b/tfplan.json` working unchanged.
    if (eq === -1 || line.slice(0, eq).includes('/')) {
      entries.push({ name: null, pattern: line })
      continue
    }

    const name = line.slice(0, eq).trim()
    const pattern = line.slice(eq + 1).trim()
    if (!NAME_PATTERN.test(name)) {
      throw new Error(
        `invalid plan name "${name}" in "plan-files": a name may contain only letters, digits, ` +
          '".", "_" and "-"'
      )
    }
    if (pattern === '') {
      throw new Error(`plan name "${name}" in "plan-files" has no glob pattern after "="`)
    }
    if (seen.has(name)) {
      throw new Error(`duplicate plan name "${name}" in "plan-files"`)
    }
    seen.add(name)
    entries.push({ name, pattern })
  }

  return entries
}
