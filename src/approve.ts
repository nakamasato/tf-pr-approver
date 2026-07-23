/**
 * Submits an approving review on the pull request, using the caller-supplied
 * token. Idempotent: skips if the current head commit already has an APPROVED
 * review.
 */
import * as core from '@actions/core'
import * as github from '@actions/github'

type Octokit = ReturnType<typeof github.getOctokit>

export interface ApproveParams {
  octokit: Octokit
  owner: string
  repo: string
  pullNumber: number
  headSha: string
  body: string
}

export interface ApproveResult {
  approved: boolean
  alreadyApproved: boolean
}

export async function approvePullRequest(params: ApproveParams): Promise<ApproveResult> {
  const { octokit, owner, repo, pullNumber, headSha, body } = params

  // Idempotency: avoid stacking duplicate approvals across re-runs / pushes.
  // If the current head commit already has an APPROVED review, there is nothing to do.
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  })
  const alreadyApproved = reviews.some(
    (r: { state?: string; commit_id?: string | null }) =>
      r.state === 'APPROVED' && r.commit_id === headSha
  )
  if (alreadyApproved) {
    core.info(`PR #${pullNumber} already has an APPROVED review at ${headSha}; skipping approval.`)
    return { approved: true, alreadyApproved: true }
  }

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    event: 'APPROVE',
    body,
  })
  core.info(`Approved PR #${pullNumber}.`)
  return { approved: true, alreadyApproved: false }
}
