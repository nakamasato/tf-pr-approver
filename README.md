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

The default `GITHUB_TOKEN` can only approve once *Allow GitHub Actions to create
and approve pull requests* is enabled; a GitHub App token is the alternative.
See **[docs/authentication.md](docs/authentication.md)** for the trade-off and
the setup steps for each.

See [`examples/workflow.yml`](examples/workflow.yml) for a complete workflow and
[`examples/tf-pr-approver.yml`](examples/tf-pr-approver.yml) for a complete
config.

## Inputs

| Input                 | Required | Default                         | Description                                                                                         |
| --------------------- | -------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `github-token`        | yes      | —                               | Token with `pull-requests: write`. The default `GITHUB_TOKEN` or a GitHub App installation token — see [docs/authentication.md](docs/authentication.md). |
| `plan-files`          | yes      | —                               | Glob pattern(s) or newline-separated paths to the plan JSON files, optionally as `name=glob` to bind a name for `tfplan_rule_map`. Every matched plan must be safe. |
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
| `plan-results`   | JSON array of per-plan results: file, name, rule set, matched rule. |

## Configuration

Config has two parts: `target_paths` (the scope check) and `rules` (the plan
check).

```yaml
target_paths:
  include:
    - terraform/**
  exclude:
    - terraform/prod/**

rules:
  - name: no-changes
    when:
      no_changes: true
```

**Rules are OR'd** — a plan is "safe" if it matches at least one rule. Within a
rule, **all conditions under `when` must hold** (AND).

Full reference — pattern matching, every condition, and what the action does in
each outcome: **[docs/configuration.md](docs/configuration.md)**.

## Documentation

| Document | Covers |
| --- | --- |
| [docs/authentication.md](docs/authentication.md) | Choosing between `GITHUB_TOKEN` and a GitHub App, and setting each one up |
| [docs/configuration.md](docs/configuration.md) | `target_paths`, rule conditions, and the skip/approve/fail behavior |
| [docs/monorepo.md](docs/monorepo.md) | Multiple stacks and docs-only PRs |
| [docs/development.md](docs/development.md) | Local development and the release process |

## License

[MIT](LICENSE)
