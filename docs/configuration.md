# Configuration reference

Config has two parts: `target_paths` (the scope check) and `rules` (the plan
check). See [`examples/tf-pr-approver.yml`](../examples/tf-pr-approver.yml).

**Rules are OR'd** — a plan is "safe" if it matches at least one rule. Within a
rule, **all conditions under `when` must hold** (AND).

```yaml
target_paths:
  include:
    - terraform/**
    - docs/**
  exclude:
    - terraform/prod/**

rules:
  - name: no-changes
    when:
      no_changes: true
  - name: safe-updates-only
    when:
      denied_actions: [delete]
      allowed_actions: [update]
      allowed_resource_types: [aws_s3_bucket_policy]
```

## `target_paths` (scope check)

Declares which files the PR is allowed to touch:

| Key       | Meaning                                                             |
| --------- | ------------------------------------------------------------------- |
| `include` | Paths that are in scope.                                            |
| `exclude` | Paths carved back out of `include`. **Takes precedence over it.**   |

A file is in scope when it matches `include` and does **not** match `exclude`.
Every changed file (including the *previous* path of a rename) must be in scope,
otherwise the action skips approval **before** looking at any plan.

| Pattern form   | Matches                                                          |
| -------------- | ---------------------------------------------------------------- |
| `terraform/**` | anything under `terraform/`                                      |
| `docs`         | the file `docs`, **or** anything under the `docs/` directory     |
| `**/*.md`      | any `.md` file at any depth                                      |

Patterns are [minimatch](https://github.com/isaacs/minimatch) globs with
`dot: true`, so `.github/**` matches dot directories. The bare-path form
(`docs` covering `docs/**`) is a convenience of this action, not standard glob
behaviour.

> [!TIP]
> Matching on `**/*.tf` alone is usually too narrow: `terraform.tfvars`,
> `.terraform.lock.hcl` and `*.tf.json` fall out of scope, so provider version
> bumps stop being auto-approved. Prefer a directory pattern like `terraform/**`.

### Why `exclude` instead of `!` patterns

A pattern starting with `!` is **rejected by config validation** in both lists.
`exclude` is a separate deny-list rather than a negation mixed into one list,
which makes the check order-independent and **monotonic**: adding an `exclude`
entry can only ever narrow the scope. A `!` in a flat list has neither property
— a single `!app/**` would match nearly every file and silently disable the
gate, and the gate failing *open* means approving without review.

> [!IMPORTANT]
> `exclude` without `include` puts **nothing** in scope — it is not read as
> "everything except these". Such a config is valid but can never approve
> anything; the action logs a warning. This is deliberate: an incomplete scope
> declaration must block approval, never grant it.

> `target_paths` itself is optional. Omitting it disables the scope check
> entirely — the action logs a warning, and a PR mixing terraform with unrelated
> changes can be approved. Set it on any monorepo. Note this is the opposite of
> an empty `include`, where nothing is in scope.

## Conditions

Actions are the Terraform plan values `no-op`, `create`, `read`, `update`,
`delete` (a *replace* appears as `["delete", "create"]`). `no-op`/`read` are
never treated as changes.

| Condition                | Meaning                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `no_changes: true`       | The plan has no effective changes (every resource is `no-op`/`read`).              |
| `allowed_actions`        | Every action in the plan must be in this list (`no-op`/`read` always allowed).     |
| `denied_actions`         | The plan must contain none of these actions (e.g. `[delete]`).                     |
| `allowed_resource_types` | Every *changed* resource's type must be in this list.                              |
| `denied_resource_types`  | No *changed* resource's type may be in this list.                                  |

At least one condition is required per rule (an empty `when` is rejected).

## Behavior

- **Any changed file outside `target_paths`** → the action **skips** approval
  immediately; the plan is not evaluated at all.
- **In scope, and all plans matched a rule** → the PR is approved (idempotently:
  an existing approval at the current commit is not duplicated).
- **Any plan matched no rule** → the action **skips** approval and writes the
  reason to the Job Summary. It exits successfully — a human reviews the PR.
- **Malformed config / input / plan JSON** → the action **fails** the job.
- **The pull request number cannot be resolved** → the action **fails** the job.
  The scope check needs the PR's changed files, so the number is resolved on
  every run; use the `pull-request-number` input in workflows that do not run on
  a `pull_request` event.

Skips always exit successfully; only misconfiguration fails the job.
