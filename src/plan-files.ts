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

/**
 * An empty path segment — `tfplans//tfplan.json` or a trailing `tfplans/`.
 *
 * A workflow builds plan patterns by interpolation
 * (`tfplans/${{ needs.x.outputs.tfplan_artifact_name }}/tfplan.json`), and a
 * skipped plan job makes that expression expand to nothing. `@actions/glob`
 * normalizes the resulting empty segment away, so the pattern silently widens
 * to `tfplans/tfplan.json` — a *different* stack's plan. The name would then be
 * bound to a plan it has nothing to do with, and the rule set selected by that
 * name would judge it. Treat such a pattern as matching nothing instead.
 *
 * A leading `//` is left alone: that is a Windows UNC root, not an empty
 * segment. A trailing separator counts, because a plan file is a file.
 */
const EMPTY_PATH_SEGMENT = /[^/]\/\/|\/$/

export function hasEmptyPathSegment(pattern: string): boolean {
  return EMPTY_PATH_SEGMENT.test(pattern)
}

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
