# Per-plan rule sets (`tfplan_rule_map`)

Design for binding a name to each plan JSON and applying a different rule set per
name, so a monorepo can express per-stack approval policy in a single config.

## Problem

Today a config has one flat `rules` list that is applied to **every** plan file.
In a monorepo where stacks carry very different risk, that is not expressive
enough: there is no way to say "anything goes in the sandbox stack, but
production only auto-approves a no-op plan" in one config.

Rules are OR'd across the whole config, so adding a permissive rule for the
sandbox also makes it apply to production plans. `target_paths` cannot help: it
is a global short-circuit over the PR's changed files, not a per-plan selector.

The workaround is to run the action several times with disjoint `plan-files`
globs and one config per risk tier. That splits the policy across N+1 files,
expresses the scope twice in two different languages (artifact globs in the
workflow, repo paths in the config), forces `allow-empty-plans: true` on every
step, and makes the approval outcome "whichever step approved first".

## Approach

A `tfplan.json` produced by `terraform show -json` does not record the directory
it was planned in, so the action cannot derive a repo path from the plan itself.
Instead of inferring, the workflow states the binding explicitly: `plan-files`
gains an optional `name=glob` form, and the config keys its rule sets by that
name.

This suits the target workflow, where each stack's plan job already exposes its
artifact name as a job output:

```yaml
plan-files: |
  sandbox=tfplans/${{ needs.di-sandbox.outputs.tfplan_artifact_name }}/tfplan.json
  prod-api=tfplans/${{ needs.di-work-recorder.outputs.tfplan_artifact_name }}/tfplan.json
```

### Alternatives rejected

- **A `paths` condition inside `when`.** `when` conditions are AND'd and rules
  are OR'd, so a rule without a `paths` condition would still apply everywhere.
  Selection has to happen one level above the rules.
- **Deriving the scope from the PR's changed files.** Needs no workflow changes,
  but cannot give per-plan granularity: a PR touching both sandbox and prod has
  to fall back to the strictest rule set for every plan. Strictly less
  expressive than naming.
- **A `{name}` placeholder inside a single `plan-files` glob.** One workflow line
  instead of N, but the names then depend on an artifact path convention rather
  than on values the plan jobs already publish.

## Config

```yaml
target_paths:
  include: ["stacks/**"]

tfplan_rule_map:
  sandbox:
    - name: anything
      when:
        allowed_actions: [create, update, delete]

  "*-prod":
    - name: no-changes
      when:
        no_changes: true

  default:
    - name: create-only
      when:
        allowed_actions: [create]
        denied_resource_types: [google_project_iam_member]
```

A map keyed by plan name, whose value is a list of rules in exactly today's
shape. `default` is a reserved key naming the fallback bucket; it is never
treated as a glob.

### Resolution, per plan

1. A key that matches the plan's name **exactly** wins.
2. Otherwise, **glob** keys are matched. Exactly one match wins; two or more is
   an error (see below).
3. Otherwise the default bucket: `tfplan_rule_map.default` if present, else the
   top-level `rules` if present (see below).
4. If neither exists, the **built-in default** applies: a single rule
   equivalent to

   ```yaml
   - name: no-changes
     when:
       no_changes: true
   ```

Step 4 is what makes every incomplete configuration fail closed. A config with
no `tfplan_rule_map` at all, a `tfplan_rule_map` with no `default`, and a plan
whose name was never listed all land on the most conservative useful rule rather
than on a hole.

Glob keys are matched with minimatch under `nonegate: true`, and keys starting
with `!` are rejected by the schema — the same treatment `paths.ts` gives
`target_paths` patterns. Names contain no `/`, so the bare-word expansion
`paths.ts` performs for path patterns does not apply here.

### Relationship to `rules`

`rules` is the pre-existing top-level rule list. It means the same thing as
`tfplan_rule_map.default`, so:

- `rules` alone — behaves exactly as today. Existing configs need no change.
- `tfplan_rule_map` alone — per-name rules plus the explicit or built-in default.
- Both, where `tfplan_rule_map` has a `default` key — **rejected**: two places
  claim the same bucket.
- Both, where `tfplan_rule_map` has no `default` key — `rules` is the default
  bucket.

`rules` also becomes optional (it is currently `nonempty()` and required). A
config with neither key is valid and evaluates every plan against the built-in
default.

## `plan-files` input

Each newline-separated line is either a bare glob (as today) or `name=glob`.

- A line is a binding when the text before its **first** `=` contains no `/`.
  A name can never contain `/`, so a pre-existing bare glob such as
  `plans/a=b/tfplan.json` keeps working.
- That text is then the name, and must match `^[A-Za-z0-9._-]+$` — anything else
  is an error rather than a silent fallback to "bare glob". Glob metacharacters
  in a name would make config-side matching ambiguous in two directions at once.
- A named glob matching more than one file is an **error**: two plans sharing one
  name cannot be told apart in the outputs or the summary.
- A named glob matching **no** file is normal, not an error — that stack simply
  was not planned in this PR.
- The same name on two lines is an **error**.
- Plans from bare-glob lines are unnamed and always resolve to the default
  bucket.

Deduplication of resolved paths stays as it is today. A file matched by both a
named and a bare glob keeps its name.

## Outputs and summary

`matched-rules` currently maps plan file to rule name. Changing its shape would
break consumers, so it stays as is and a new output carries the extra detail:

```json
{
  "plan-results": [
    {
      "file": "tfplans/tfplan-sandbox/tfplan.json",
      "name": "sandbox",
      "ruleSet": "sandbox",
      "rule": "anything",
      "matched": true
    },
    {
      "file": "tfplans/tfplan-misc/tfplan.json",
      "name": null,
      "ruleSet": "built-in default",
      "rule": null,
      "matched": false
    }
  ]
}
```

`ruleSet` records which bucket was selected — the matching key, `default`, or
the built-in default — so a reviewer can tell from the output alone whether a
plan got the rules its author intended.

The job summary's plan table gains **Name** and **Rule set** columns. Plans
evaluated against the built-in default are called out explicitly, since that
usually means a name was never wired up.

## Error handling

Following the project's existing policy — a config or input problem is a
failure, an unmet condition is a skip:

**Failure (`core.setFailed`)**

- A name that is not `^[A-Za-z0-9._-]+$`
- A duplicate name across `plan-files` lines
- A named glob resolving to more than one file
- A plan name matched by two or more glob keys with no exact key
- `rules` present alongside `tfplan_rule_map.default`
- A `tfplan_rule_map` key starting with `!`
- An empty rule list under any key

**Warning**

- A `tfplan_rule_map` key that matched no plan in this run. It cannot be
  distinguished from a stack that was simply not planned in this PR, and it
  fails in the safe direction: the intended rules go unused and the plan falls
  through to a stricter bucket.

**Unchanged**

- No rule matched a plan — still a skip, no approval.

## Security note

Plan names come from the workflow file, which lives in the repository. Under
`pull_request` the head branch's workflow is what runs, so a PR that edits the
workflow could rename a production artifact into a permissive bucket. The
existing `target_paths` gate is what prevents this, and only if the workflow
directory is excluded from scope. This must be documented as a requirement
rather than a suggestion wherever `tfplan_rule_map` is described.

Detecting a name-to-artifact mismatch is out of scope here. Adding an optional
`paths` selector alongside the name — where a permissive bucket applies only if
the PR's changed files also fall under those paths — would close the gap and can
be layered on additively later.

## Modules

Two new pure modules, keeping I/O in `main.ts` as the architecture already does:

- `src/plan-files.ts` — parse the `plan-files` input into `{name, pattern}`
  entries and validate names and duplicates. No globbing, no filesystem.
- `src/rule-map.ts` — resolve a plan name to a rule set, returning the rules and
  the bucket label. Owns the exact-then-glob precedence and the built-in default.

`evaluate.ts` is untouched: it already takes `(plan, rules)`, so per-plan rule
sets only change which array is handed to it. `config.ts` gains the
`tfplan_rule_map` schema and relaxes `rules`. `main.ts` wires the pieces
together. `summary.ts` gains the two columns.

## Testing

- `plan-files.test.ts` — bare globs, `name=glob`, `=` inside the path, invalid
  name characters, duplicate names, empty name, empty pattern.
- `rule-map.test.ts` — exact match, single glob match, exact beating glob,
  ambiguous glob match, explicit `default`, built-in default, `rules` used as the
  default bucket.
- `config.test.ts` — `tfplan_rule_map` schema, `!` key rejection, empty rule
  list, `rules` + `default` coexistence, config with neither key.
- `main.test.ts` — end-to-end: two named plans landing in different buckets with
  different verdicts, a named glob matching two files, an unnamed plan falling to
  the default, and the new `plan-results` output.

`dist/` must be rebuilt with `npm run package` and committed alongside `src/`.

## Documentation

- `docs/configuration.md` — `tfplan_rule_map`, resolution order, the built-in
  default, and the relationship to `rules`.
- `docs/monorepo.md` — the per-stack example built on job outputs, and the
  `target_paths` requirement from the security note.
- `README.md` — `plan-files` input description covering the `name=glob` form.
- `action.yml` — `plan-files` description, and the new `plan-results` output.
