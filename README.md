# tf-pr-approver

A GitHub Action that **auto-approves Terraform pull requests** when the
`terraform plan` result matches declarative safety rules — using a **GitHub App
identity** so the approval counts toward your branch's required reviews.

## Why

You want **Required approvals ≥ 1** on your Terraform repo, but:

- **CodeOwners** only lets you gate by file/directory, not by *what actually changes*.
- Many PRs are provably safe (a `plan` with **no changes**, or only a narrow set
  of resource updates) and don't need a human to click approve.

`tf-pr-approver` evaluates the plan JSON against rules you configure and, when
it's safe, approves the PR as a bot — so humans only review the changes that
matter, without weakening the required-review rule.

> `github-actions[bot]` (the default `GITHUB_TOKEN`) **cannot approve PRs**, and
> a PR author can't approve their own PR. A GitHub App is a distinct identity
> whose approval *does* count toward required reviews — that's why this action
> uses one.

## How it works

```
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json   # you produce this
        │
        ▼
tf-pr-approver:  parse plan JSON → evaluate rules → approve if safe
```

The action does **not** run `terraform` and does **not** authenticate the App
itself. Your workflow produces the plan JSON and mints the token (via
[`actions/create-github-app-token`](https://github.com/actions/create-github-app-token));
this action focuses on evaluation + approval.

## Usage

See [`examples/workflow.yml`](examples/workflow.yml) for a complete workflow.

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  # ... produce tfplan.json with `terraform show -json` ...

  # Variable/secret names here are examples — use whatever you already have.
  - uses: actions/create-github-app-token@v1
    id: app-token
    with:
      app-id: ${{ vars.APP_ID }}
      private-key: ${{ secrets.APP_PRIVATE_KEY }}

  - uses: nakamasato/tf-pr-approver@v1
    with:
      github-token: ${{ steps.app-token.outputs.token }}
      plan-files: '**/tfplan.json'
      config: .github/tf-pr-approver.yml
```

### GitHub App setup

1. Create a GitHub App with **Pull requests: Read & write** permission.
2. Install it on the repositories you want to auto-approve.
3. Store its App ID as a variable and its private key as a secret — **under any
   names you like**. This action never references them; it only receives the
   generated token through the `github-token` input.

## Inputs

| Input                 | Required | Default                         | Description                                                                                         |
| --------------------- | -------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `github-token`        | yes      | —                               | GitHub App installation token with `pull-requests: write`. **Not** the default `GITHUB_TOKEN`.      |
| `plan-files`          | yes      | —                               | Glob pattern(s) or newline-separated paths to the plan JSON files. Every matched plan must be safe. |
| `config`              | no       | `.github/tf-pr-approver.yml`  | Path to the rules config.                                                                            |
| `pull-request-number` | no       | (from event)                    | PR number to approve. Defaults to the PR in the event context.                                      |
| `approve-message`     | no       | (a default message)             | Body text for the approval review.                                                                  |

## Outputs

| Output          | Description                                                            |
| --------------- | --------------------------------------------------------------------- |
| `approved`      | `"true"` if the PR was approved (or already approved), else `"false"`. |
| `matched-rules` | JSON object mapping each plan file to the rule it matched (or `null`). |

## Config reference

Config is a list of `rules`. **Rules are OR'd** — a plan is "safe" if it matches
at least one rule. Within a rule, **all conditions under `when` must hold** (AND).
See [`examples/tf-pr-approver.yml`](examples/tf-pr-approver.yml).

```yaml
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

### Conditions

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

- **All plans matched a rule** → the PR is approved (idempotently: an existing
  approval at the current commit is not duplicated).
- **Any plan matched no rule** → the action **skips** approval and writes the
  reason to the Job Summary. It exits successfully — a human reviews the PR.
- **Malformed config / input / plan JSON** → the action **fails** the job.

## Multiple stacks (monorepo)

`plan-files` may match many plan JSON files. The PR is approved only when **every**
matched plan is individually safe.

## Development

```bash
npm ci
npm test        # unit tests (vitest)
npm run build   # type-check (tsc)
npm run all     # build + test + package (esbuild → dist/)
```

`dist/` is committed and kept in sync with `src/` — enforced by
[`check-dist`](.github/workflows/check-dist.yml). Run `npm run package` and commit
`dist/` whenever you change `src/`.

## License

[MIT](LICENSE)
