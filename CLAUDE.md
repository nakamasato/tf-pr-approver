# tf-pr-approver

A GitHub Action that evaluates Terraform plan JSON against declarative rules and
auto-approves safe PRs using a caller-supplied token (TypeScript / Node 24).

User-facing specs (inputs, outputs, config reference) live in [README.md](README.md).
This file only covers what is easy to break.

## Language

**Write everything in English**: code comments, doc comments, documentation,
commit messages, PR titles and bodies, review comments, and issue text.

## Commands

```bash
npm ci
npm test              # vitest
npm run lint          # eslint
npm run format        # prettier (CI runs format:check, so run this before committing)
npm run build         # tsc type check
npm run package       # esbuild → dist/index.js  ← required whenever src/ changes
npm run all           # build + test + package
```

## ⚠️ dist/ is committed

The Action actually runs `dist/index.js`. Whenever you change `src/`, you **must**
run `npm run package` and commit `dist/` along with it. Forgetting it fails the
`check-dist` workflow and silently ships stale behavior.

## PR / commit convention

- **PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/)**
  (`feat:` / `fix:` / `chore:` / `ci:` / `docs:` ...). PRs are squash-merged, so the
  title becomes the commit message on main and is what release-please reads to pick
  the next version — a malformed title silently produces no release. The `pr-title`
  workflow checks this in CI.
- `fix:` → patch / `feat:` → minor / `feat!:` or `BREAKING CHANGE:` → major

## Architecture

`src/index.ts` → `run()` in `src/main.ts` orchestrates everything (`index.ts` stays
thin so tests can drive `run()` directly).

1. `config.ts` — load YAML + validate with zod
2. `changed-files.ts` + `paths.ts` — **scope gate** (short-circuits here)
3. `plan.ts` — parse plan JSON
4. `evaluate.ts` — rule evaluation (rules are OR'd, conditions within `when` are AND'd)
5. `approve.ts` — approve (idempotent: skips if the head SHA is already APPROVED)
6. `summary.ts` — write the job summary

Keep `evaluate.ts` and `paths.ts` free of I/O and side effects.

## Fail-closed invariants (they look like bugs, but they are deliberate)

This is a security gate, so when in doubt it must fall back to "do not approve".
Do not "fix" the following.

- `target_paths` with only `exclude` puts **nothing** in scope (so nothing is approved)
- Omitting `target_paths` disables the gate entirely (every file is in scope), which is
  not the same as an empty `include`
- `allow-empty-plans: true` without `target_paths` is **rejected with an error** (the
  combination would approve any PR unconditionally)
- Patterns starting with `!` are rejected twice over: by the zod schema and by
  minimatch's `nonegate: true`
- Throw when the changed-file count reaches GitHub's 3000-file limit (a truncated list
  makes the scope check untrustworthy)
- Renames put both the old and the new path in scope

## Error policy

- "conditions not met" → a normal **skip** (`core.info` + `approved=false`)
- malformed config, input, or plan JSON → **failure** (`core.setFailed`)
