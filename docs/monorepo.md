# Monorepo usage

## Multiple stacks

`plan-files` may match many plan JSON files. The PR is approved only when **every**
matched plan is individually safe.

> The action can only evaluate the plans that exist on disk. If a stack's plan
> step is skipped, no plan JSON is produced and that stack is invisible here —
> keep the plan job's failure fatal so this action never runs on a partial set.

## Docs-only PRs

Put the docs paths in `target_paths` and set `allow-empty-plans: true`:

```yaml
# .github/tf-pr-approver.yml
target_paths:
  include:
    - terraform/**
    - docs/**
rules:
  - name: no-changes
    when:
      no_changes: true
```

```yaml
# workflow
with:
  allow-empty-plans: 'true'
```

A PR touching only `docs/**` passes the scope check and has nothing to evaluate,
so it is approved. A PR touching `docs/**` *and* `app/**` fails the scope check.

> `allow-empty-plans: true` **requires** `target_paths`; the action fails
> otherwise. With no scope check, an empty plan set would approve any PR.
>
> It also makes the scope check the *only* gate whenever the plan JSON is
> missing — a failed artifact upload or a typo in `plan-files` is
> indistinguishable from a legitimate docs-only PR. The action logs a warning in
> that case; keep the plan job's failure fatal so it cannot happen silently.

## Different rules per stack

Bind a name to each stack's plan and give the risky ones their own rule set. The
plan jobs already know their artifact names, so the workflow can pass them
through:

```yaml
- uses: nakamasato/tf-pr-approver@v1
  with:
    plan-files: |
      sandbox=tfplans/${{ needs.sandbox.outputs.tfplan_artifact_name }}/tfplan.json
      api-prod=tfplans/${{ needs.api-prod.outputs.tfplan_artifact_name }}/tfplan.json
```

A plan job that was skipped produces no output, so its line arrives as
`tfplans//tfplan.json`. The action treats a glob with an **empty path segment**
as matching nothing — the stack simply was not planned. It deliberately does not
let the empty segment collapse to `tfplans/tfplan.json`, which would bind the
name to some other stack's plan and judge it by this stack's rule set.

Excluding the workflow files from `target_paths` is **required** when using
`tfplan_rule_map`: plan names come from the workflow, and under `pull_request`
the head branch's workflow is what runs, so without that exclusion a PR could
rename a production artifact into a permissive rule set.

```yaml
# .github/tf-pr-approver.yml
target_paths:
  include:
    - stacks/**
  exclude:
    - .github/workflows/**
    - .github/tf-pr-approver.yml

tfplan_rule_map:
  sandbox:
    - name: anything
      when:
        allowed_actions: [create, update, delete]
  default:
    - name: no-changes
      when:
        no_changes: true
```

A named entry that matches no file is fine — only the stacks a PR touches
produce an artifact. A named entry matching *several* files fails the job: a
name has to identify one plan for the summary and `plan-results` to stay
readable.

### Keep the download layout stable

`actions/download-artifact` extracts a **single** artifact directly into `path`
and only nests each artifact under its own name once two or more match. A
workflow whose names expect `tfplans/<artifact-name>/tfplan.json` therefore gets
that layout only while several stacks planned; with exactly one, the file lands
at `tfplans/tfplan.json` and no named entry matches it. Either pin the download
path, or carry the stack directory inside the artifact.

**Download each artifact into its own directory.**

```yaml
- if: needs.sandbox.outputs.tfplan_artifact_name != ''
  uses: actions/download-artifact@v4
  with:
    name: ${{ needs.sandbox.outputs.tfplan_artifact_name }}
    path: tfplans/${{ needs.sandbox.outputs.tfplan_artifact_name }}
```

Naming `path` yourself removes the artifact-count branch entirely. The `if:`
guard is not optional: a skipped plan job leaves the name empty, and an empty
`name` makes `download-artifact` fetch **every** artifact in the run, which puts
the branch right back.

**Or upload the plan as `<stack>/tfplan.json`** and keep one download step for
everything. The stack directory then travels inside the artifact, so it survives
whichever way the artifact is extracted, and a `**` glob matches both layouts:

```yaml
plan-files: |
  sandbox=tfplans/**/sandbox/tfplan.json
  api-prod=tfplans/**/api-prod/tfplan.json
```

`**` matches zero directories as well as many, so this reaches
`tfplans/sandbox/tfplan.json` when the artifact was flattened and
`tfplans/<artifact-name>/sandbox/tfplan.json` when it was not. Brace expansion
(`tfplans/{,*/}sandbox/tfplan.json`) does **not** work — `@actions/glob` does not
expand braces. This scales better than one download step per stack once there
are many of them.

Getting this right matters most when a bare catch-all glob sits alongside the
named entries. A diverging layout then makes the catch-all pick the plans up
**unnamed**, and they are evaluated under `default` rather than their own rule
set — with nothing in the log to distinguish that from stacks that were never
planned, because both produce the same "no plan file matched" line. The action
cannot recover the name: a plan file carries no record of which stack it came
from, which is why `plan-files` has to state the binding.

See [configuration.md](configuration.md#tfplan_rule_map-per-plan-rules) for the
full resolution order and the `target_paths` requirement.
