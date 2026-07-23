# tf-pr-approver

A GitHub Action that **auto-approves Terraform pull requests** when the
`terraform plan` result matches declarative safety rules, so the approval counts
toward your branch's required reviews.

> [!NOTE]
> **This project is in alpha.** Inputs, outputs and the config schema may change
> without notice, and breaking changes can land in minor releases. Pin to a
> specific tag or commit SHA, and review the release notes before upgrading.

## Why

You want **Required approvals ≥ 1** on your Terraform repo, but:

- **[CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)**
  only lets you gate by path — its patterns "follow most of the same rules used
  in gitignore files" — so it can't distinguish a no-op `plan` from a `destroy`
  in the same directory.
- Many PRs are provably safe (a `plan` with **no changes**, or only a narrow set
  of resource updates) and don't need a human to click approve.

`tf-pr-approver` evaluates the plan JSON against rules you configure and, when
it's safe, approves the PR as a bot — so humans only review the changes that
matter, without weakening the required-review rule.

> [!IMPORTANT]
> **Which identity should the approval come from?**
>
> Both of the options below produce an approval that counts toward required
> reviews. They differ in how widely you hand out the right to approve.
>
> - **The default `GITHUB_TOKEN`.** Approving is blocked unless
>   [*Allow GitHub Actions to create and approve pull requests*](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests)
>   is enabled at both the org and repo level; it is off by default. Once it is
>   on, the switch applies repo-wide — **every** workflow in the repo can
>   approve, including one added by the pull request under review, since a PR
>   from a branch of the same repo gets a write-scoped token.
> - **A GitHub App installation token.** A distinct identity whose credentials
>   live in a secret, so the ability to approve reaches only the jobs that can
>   read that secret (and can be narrowed further with
>   [environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)).
>   The cost is creating the App and rotating its private key.
>
> Neither identity can approve a pull request it opened itself. If a bot raises
> the PRs you want auto-approved, the approving identity has to be a different
> one — `github-actions[bot]` cannot approve a PR that `github-actions[bot]`
> created.

## How it works

```
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json   # you produce this
        │
        ▼
tf-pr-approver:
  1. scope check — does the PR touch anything outside `target_paths`?  → if yes, skip
  2. plan rules  — does every plan JSON match a safe-change rule?      → if yes, approve
```

The scope check runs **first and short-circuits**. A PR that also changes
application code, CI workflows or anything else outside `target_paths` is never
auto-approved, however safe its terraform plan looks.

The action does **not** run `terraform` and does **not** obtain a token itself.
Your workflow produces the plan JSON and supplies the token; this action focuses
on evaluation + approval.

## Usage

See [`examples/workflow.yml`](examples/workflow.yml) for a complete workflow.

With the default `GITHUB_TOKEN`:

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  # ... produce tfplan.json with `terraform show -json` ...

  - uses: nakamasato/tf-pr-approver@v1
    with:
      github-token: ${{ secrets.GITHUB_TOKEN }}
      plan-files: '**/tfplan.json'
      config: .github/tf-pr-approver.yml
```

With a GitHub App token — swap the `github-token` value for one you mint in the
workflow:

```yaml
  # Variable/secret names here are examples — use whatever you already have.
  - uses: actions/create-github-app-token@v1
    id: app-token
    with:
      app-id: ${{ vars.APP_ID }}
      private-key: ${{ secrets.APP_PRIVATE_KEY }}

  - uses: nakamasato/tf-pr-approver@v1
    with:
      github-token: ${{ steps.app-token.outputs.token }}
      # ... same as above ...
```

### Enabling the default `GITHUB_TOKEN` to approve

Turn on *Allow GitHub Actions to create and approve pull requests* under
**Settings → Actions → General**, at both the organization and the repository
level. Read the trade-off in [Why](#why) before you do: it lets every workflow
in the repository approve pull requests, not just this one.

### GitHub App setup

1. Create a GitHub App with **Pull requests: Read & write** permission.
2. Install it on the repositories you want to auto-approve.
3. Store its App ID as a variable and its private key as a secret — **under any
   names you like**. This action never references them; it only receives the
   generated token through the `github-token` input.

## Inputs

| Input                 | Required | Default                         | Description                                                                                         |
| --------------------- | -------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `github-token`        | yes      | —                               | Token with `pull-requests: write`. The default `GITHUB_TOKEN` or a GitHub App installation token — see [Why](#why). |
| `plan-files`          | yes      | —                               | Glob pattern(s) or newline-separated paths to the plan JSON files. Every matched plan must be safe. |
| `config`              | no       | `.github/tf-pr-approver.yml`  | Path to the rules config.                                                                            |
| `allow-empty-plans`   | no       | `false`                         | Treat "no plan file matched" as OK instead of failing (needed for docs-only PRs).                    |
| `pull-request-number` | no       | (from event)                    | PR number to approve. Defaults to the PR in the event context.                                      |
| `approve-message`     | no       | (a default message)             | Body text for the approval review.                                                                  |

## Outputs

| Output               | Description                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| `approved`           | `"true"` if the PR was approved (or already approved), else `"false"`.          |
| `matched-rules`      | JSON object mapping each plan file to the rule it matched (or `null`).          |
| `out-of-scope-files` | JSON array of changed files outside `target_paths` (empty when the check passed). |

## Config reference

Config has two parts: `target_paths` (the scope check) and `rules` (the plan
check). See [`examples/tf-pr-approver.yml`](examples/tf-pr-approver.yml).

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

### `target_paths` (scope check)

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

#### Why `exclude` instead of `!` patterns

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

## Monorepo usage

### Multiple stacks

`plan-files` may match many plan JSON files. The PR is approved only when **every**
matched plan is individually safe.

> The action can only evaluate the plans that exist on disk. If a stack's plan
> step is skipped, no plan JSON is produced and that stack is invisible here —
> keep the plan job's failure fatal so this action never runs on a partial set.

### Docs-only PRs

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

## Releasing

Releases are automated by
[`release`](.github/workflows/release.yml), which runs
[release-please](https://github.com/googleapis/release-please-action).

1. Land changes on `main` using [Conventional Commits](https://www.conventionalcommits.org/)
   (`fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major).
2. release-please keeps a release PR open, bumping `package.json` and
   `CHANGELOG.md`. Merge it when you want to cut a release.
3. Merging creates the immutable tag (`v1.2.3`) and its GitHub Release, then the
   workflow moves the mutable major tag (`v1`) onto that release so consumers
   pinning `@v1` pick it up automatically.

`v1` is force-updated on every v1.x release; `v1.2.3` is never moved. A breaking
change starts a `v2` tag and leaves `v1` frozen at the last v1 release.

> **After the first release**, remove `"release-as": "1.0.0"` from
> [`release-please-config.json`](release-please-config.json). It exists only to
> start at 1.0.0 instead of bumping the current 0.1.0, and would otherwise pin
> every subsequent release to the same version.

## License

[MIT](LICENSE)
