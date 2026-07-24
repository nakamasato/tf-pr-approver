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

See [configuration.md](configuration.md#tfplan_rule_map-per-plan-rules) for the
full resolution order and the `target_paths` requirement.
