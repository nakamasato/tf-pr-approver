/**
 * Fetches the list of files a pull request changes, used by the scope gate
 * (see {@link ./paths}).
 */
import * as core from '@actions/core'
import * as github from '@actions/github'

type Octokit = ReturnType<typeof github.getOctokit>

/** GitHub's `pulls.listFiles` returns at most this many files. */
const LIST_FILES_LIMIT = 3000

export interface ListChangedFilesParams {
  octokit: Octokit
  owner: string
  repo: string
  pullNumber: number
}

/**
 * Return every path the PR touches. Renames contribute both the new and the
 * previous path, so moving a file *out of* the target paths is also in scope.
 */
export async function listChangedFiles(params: ListChangedFilesParams): Promise<string[]> {
  const { octokit, owner, repo, pullNumber } = params
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  })

  if (files.length >= LIST_FILES_LIMIT) {
    // Truncated listings would let out-of-scope files slip through unseen.
    throw new Error(
      `pull request #${pullNumber} changes ${files.length} files, at or above GitHub's ` +
        `${LIST_FILES_LIMIT}-file listing limit; the changed-file list may be truncated ` +
        'so the scope check cannot be trusted'
    )
  }

  const paths = new Set<string>()
  for (const file of files as Array<{ filename: string; previous_filename?: string }>) {
    paths.add(file.filename)
    if (file.previous_filename) {
      paths.add(file.previous_filename)
    }
  }
  core.debug(`changed files: ${JSON.stringify([...paths])}`)
  return [...paths]
}
