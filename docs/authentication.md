# Authentication

The action never obtains a token itself. Your workflow supplies one through the
`github-token` input, and the review is submitted as whatever identity that
token belongs to.

## Choosing the identity

Both options below produce an approval that counts toward required reviews. They
differ in how widely you hand out the right to approve.

| | Default `GITHUB_TOKEN` | GitHub App installation token |
| --- | --- | --- |
| Setup | A repository/organization setting | Create an App, store its private key |
| Who can approve | Every workflow in the repository | Only jobs that can read the private key |
| Ongoing cost | None | Key rotation, App administration |

- **The default `GITHUB_TOKEN`.** Approving is blocked unless *Allow GitHub
  Actions to create and approve pull requests* is enabled at both the org and
  repo level; it is off by default. Once it is on, the switch applies repo-wide
  — **every** workflow in the repo can approve, including one added by the pull
  request under review, since a PR from a branch of the same repo gets a
  write-scoped token.
- **A GitHub App installation token.** A distinct identity whose credentials
  live in a secret, so the ability to approve reaches only the jobs that can
  read that secret (and can be narrowed further with
  [environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)).
  The cost is creating the App and rotating its private key.

> [!IMPORTANT]
> Neither identity can approve a pull request it opened itself. If a bot raises
> the PRs you want auto-approved, the approving identity has to be a different
> one — `github-actions[bot]` cannot approve a PR that `github-actions[bot]`
> created.

## Enabling the default `GITHUB_TOKEN` to approve

Under "Workflow permissions", turn on **Allow GitHub Actions to create and
approve pull requests**. The setting exists at two levels and both must allow
it:

- [Repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests)
  — **Settings → Actions → General**
- [Organization](https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization#preventing-github-actions-from-creating-or-approving-pull-requests)
  — **Settings → Actions → General**

Then pass the token straight through:

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: nakamasato/tf-pr-approver@v1
    with:
      github-token: ${{ secrets.GITHUB_TOKEN }}
      plan-files: '**/tfplan.json'
```

## GitHub App setup

1. Create a GitHub App with **Pull requests: Read & write** permission.
2. Install it on the repositories you want to auto-approve.
3. Store its App ID as a variable and its private key as a secret — **under any
   names you like**. This action never references them; it only receives the
   generated token through the `github-token` input.

Mint the token in the workflow with
[`actions/create-github-app-token`](https://github.com/actions/create-github-app-token)
and pass its output:

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
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
```
