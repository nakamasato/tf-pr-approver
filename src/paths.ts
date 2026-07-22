/**
 * Scope gate: decides whether the pull request touches only the files and
 * directories the config declares as in scope (`target_paths`).
 *
 * This runs *before* any plan evaluation: a PR that changes anything outside
 * the declared scope (application code, CI config, ...) is never auto-approved,
 * no matter how safe the terraform plan looks.
 *
 * Pure logic, no I/O, so it can be unit-tested exhaustively.
 */
import { minimatch } from 'minimatch'

export interface PathCheckResult {
  /** True when every changed file is covered by at least one target path. */
  matched: boolean
  /** Changed files not covered by any target path (empty when matched). */
  outOfScopeFiles: string[]
}

/** Characters that make a pattern a glob rather than a literal path. */
const GLOB_MAGIC = /[*?[\]{}!()]/

const MINIMATCH_OPTIONS = { dot: true } as const

/**
 * A pattern without glob characters is ambiguous: users write `docs` meaning
 * "the docs directory" and `README.md` meaning "that one file". Expand it to
 * both so either intent works, without matching a sibling like `docsite/`.
 */
function expandPattern(pattern: string): string[] {
  const normalized = pattern.replace(/^\.\//, '').replace(/\/+$/, '')
  if (GLOB_MAGIC.test(normalized)) {
    return [normalized]
  }
  return [normalized, `${normalized}/**`]
}

/** True when `file` is covered by at least one of `patterns`. */
export function isTargetPath(file: string, patterns: string[]): boolean {
  return patterns
    .flatMap(expandPattern)
    .some((pattern) => minimatch(file, pattern, MINIMATCH_OPTIONS))
}

/**
 * Check the PR's changed files against the configured target paths.
 * Order of `outOfScopeFiles` follows the input order so reports stay stable.
 */
export function checkChangedFiles(files: string[], patterns: string[]): PathCheckResult {
  const outOfScopeFiles = files.filter((f) => !isTargetPath(f, patterns))
  return { matched: outOfScopeFiles.length === 0, outOfScopeFiles }
}
