/**
 * Orchestration tests for `run()`.
 *
 * The focus is the security-relevant branching: the scope gate short-circuit
 * and the `allow-empty-plans` handling, where an empty plan set otherwise
 * evaluates to "everything matched".
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@actions/core')
vi.mock('@actions/github')
vi.mock('@actions/glob')
vi.mock('../src/changed-files')
vi.mock('../src/approve')
vi.mock('../src/summary')

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as glob from '@actions/glob'
import { listChangedFiles } from '../src/changed-files'
import { approvePullRequest } from '../src/approve'
import { run } from '../src/main'

const FIXTURES = path.join(__dirname, 'fixtures')

let tmpDir: string
let configPath: string
let inputs: Record<string, string>
let planFiles: string[]

function writeConfig(yaml: string): void {
  fs.writeFileSync(configPath, yaml, 'utf8')
}

/** Every output the action set, keyed by name. */
function outputs(): Record<string, string> {
  const calls = vi.mocked(core.setOutput).mock.calls as Array<[string, string]>
  return Object.fromEntries(calls)
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-pr-approver-'))
  configPath = path.join(tmpDir, 'config.yml')
  writeConfig(`
target_paths:
  include:
    - terraform/**
rules:
  - name: no changes
    when:
      no_changes: true
`)

  inputs = {
    'github-token': 'token',
    'plan-files': 'plans/*.json',
    config: configPath,
    'approve-message': 'approved',
    'allow-empty-plans': 'false',
  }
  planFiles = []

  vi.mocked(core.getInput).mockImplementation((name: string) => inputs[name] ?? '')
  vi.mocked(core.getBooleanInput).mockImplementation(
    (name: string) => (inputs[name] ?? 'false') === 'true'
  )
  vi.mocked(glob.create).mockImplementation(
    async () => ({ glob: async () => planFiles }) as unknown as glob.Globber
  )
  vi.mocked(github.getOctokit).mockReturnValue({
    rest: { pulls: { get: async () => ({ data: { head: { sha: 'deadbeef' } } }) } },
  } as unknown as ReturnType<typeof github.getOctokit>)
  vi.mocked(listChangedFiles).mockResolvedValue(['terraform/main.tf'])
  Object.defineProperty(github, 'context', {
    value: { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: { number: 7 } } },
    configurable: true,
  })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('run: allow-empty-plans', () => {
  it('fails instead of approving when there is no scope gate to fall back on', async () => {
    // Regression: `[].every(...)` is true, so an empty plan set plus a disabled
    // scope gate used to auto-approve literally any pull request.
    writeConfig('rules:\n  - name: no changes\n    when:\n      no_changes: true\n')
    inputs['allow-empty-plans'] = 'true'

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('requires "target_paths"'))
    expect(approvePullRequest).not.toHaveBeenCalled()
    expect(outputs().approved).toBeUndefined()
  })

  it('fails when no plan matched and empty plans are not allowed', async () => {
    await run()

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('no plan files matched'))
    expect(approvePullRequest).not.toHaveBeenCalled()
  })

  it('approves on the scope check alone but warns that no plan was evaluated', async () => {
    inputs['allow-empty-plans'] = 'true'

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('no plan was evaluated'))
    expect(approvePullRequest).toHaveBeenCalledOnce()
    expect(outputs().approved).toBe('true')
  })
})

describe('run: scope gate', () => {
  it('skips approval without evaluating any plan when a file is out of scope', async () => {
    vi.mocked(listChangedFiles).mockResolvedValue(['terraform/main.tf', 'app/main.go'])
    planFiles = [path.join(FIXTURES, 'no-changes.json')]

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(approvePullRequest).not.toHaveBeenCalled()
    expect(outputs()).toEqual({
      approved: 'false',
      'matched-rules': '{}',
      'out-of-scope-files': JSON.stringify(['app/main.go']),
    })
  })

  it('approves when the PR is in scope and every plan matches a rule', async () => {
    planFiles = [path.join(FIXTURES, 'no-changes.json')]

    await run()

    expect(approvePullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'o', repo: 'r', pullNumber: 7, headSha: 'deadbeef' })
    )
    expect(outputs()).toEqual({
      approved: 'true',
      'matched-rules': JSON.stringify({ [planFiles[0]]: 'no changes' }),
      'out-of-scope-files': '[]',
    })
  })

  it('skips approval when a plan matches no rule', async () => {
    planFiles = [path.join(FIXTURES, 'with-delete.json')]

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(approvePullRequest).not.toHaveBeenCalled()
    expect(outputs().approved).toBe('false')
  })

  it('warns and treats every file as in scope when target_paths is absent', async () => {
    writeConfig('rules:\n  - name: no changes\n    when:\n      no_changes: true\n')
    planFiles = [path.join(FIXTURES, 'no-changes.json')]

    await run()

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('no "target_paths"'))
    expect(listChangedFiles).not.toHaveBeenCalled()
    expect(outputs().approved).toBe('true')
  })

  it('skips a file carved out by exclude even though include covers it', async () => {
    writeConfig(`
target_paths:
  include:
    - terraform/**
  exclude:
    - terraform/prod/**
rules:
  - name: no changes
    when:
      no_changes: true
`)
    vi.mocked(listChangedFiles).mockResolvedValue(['terraform/dev/a.tf', 'terraform/prod/b.tf'])
    planFiles = [path.join(FIXTURES, 'no-changes.json')]

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(approvePullRequest).not.toHaveBeenCalled()
    expect(outputs().approved).toBe('false')
    expect(JSON.parse(outputs()['out-of-scope-files'])).toEqual(['terraform/prod/b.tf'])
  })

  it('never approves when target_paths has exclude but no include', async () => {
    // An `exclude` with no `include` declares no scope at all. Reading it as
    // "everything except these" would turn an incomplete config into a blanket
    // auto-approval, so it must put nothing in scope and warn loudly.
    writeConfig(`
target_paths:
  exclude:
    - app/**
rules:
  - name: no changes
    when:
      no_changes: true
`)
    vi.mocked(listChangedFiles).mockResolvedValue(['terraform/main.tf'])
    planFiles = [path.join(FIXTURES, 'no-changes.json')]

    await run()

    // A safe skip, not a crash: the config is valid, it just allows nothing.
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(approvePullRequest).not.toHaveBeenCalled()
    expect(outputs().approved).toBe('false')
    expect(JSON.parse(outputs()['out-of-scope-files'])).toEqual(['terraform/main.tf'])
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('no "include" patterns'))
  })

  it('never approves with exclude but no include, even for a docs-only PR', async () => {
    // The dangerous variant: `allow-empty-plans` means the scope gate is the
    // only check left, so an "everything except these" reading would approve
    // this PR outright.
    writeConfig(`
target_paths:
  exclude:
    - app/**
rules:
  - name: no changes
    when:
      no_changes: true
`)
    inputs['allow-empty-plans'] = 'true'
    vi.mocked(listChangedFiles).mockResolvedValue(['docs/a.md'])
    planFiles = []

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(approvePullRequest).not.toHaveBeenCalled()
    expect(outputs().approved).toBe('false')
  })
})

describe('run: pull request number', () => {
  it('fails when the number can be resolved from neither input nor event context', async () => {
    Object.defineProperty(github, 'context', {
      value: { repo: { owner: 'o', repo: 'r' }, payload: {} },
      configurable: true,
    })
    planFiles = [path.join(FIXTURES, 'no-changes.json')]

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('could not determine the pull request number')
    )
  })

  it('prefers the explicit pull-request-number input', async () => {
    inputs['pull-request-number'] = '42'
    planFiles = [path.join(FIXTURES, 'no-changes.json')]

    await run()

    expect(approvePullRequest).toHaveBeenCalledWith(expect.objectContaining({ pullNumber: 42 }))
  })
})
