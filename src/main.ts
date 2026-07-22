/**
 * Entry point / orchestration.
 *
 * Flow:
 *   1. load + validate config
 *   2. resolve plan files (glob / newline list)
 *   3. evaluate each plan against the rules
 *   4. approve the PR only if every plan matched a rule (idempotently)
 *   5. write outputs + job summary
 *
 * Error policy: "conditions not met" is a normal (skip) outcome; malformed
 * config / input / plan is a failure (core.setFailed).
 */
import * as fs from 'fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import * as glob from '@actions/glob'
import { loadConfig } from './config'
import { parsePlan } from './plan'
import { evaluatePlan } from './evaluate'
import { approvePullRequest } from './approve'
import { PlanResult, writeSummary } from './summary'

async function resolvePlanFiles(input: string): Promise<string[]> {
  const globber = await glob.create(input, { matchDirectories: false })
  const files = await globber.glob()
  return Array.from(new Set(files))
}

function getPullNumber(): number {
  const raw = core.getInput('pull-request-number')
  if (raw) {
    const n = Number.parseInt(raw, 10)
    if (Number.isNaN(n)) {
      throw new Error(`invalid pull-request-number: "${raw}"`)
    }
    return n
  }
  const pr = github.context.payload.pull_request
  if (!pr) {
    throw new Error(
      'could not determine the pull request number from the event context; set the "pull-request-number" input'
    )
  }
  return pr.number
}

export async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true })
    const planInput = core.getInput('plan-files', { required: true })
    const configPath = core.getInput('config')
    const approveMessage = core.getInput('approve-message')

    const config = loadConfig(configPath)

    const planFiles = await resolvePlanFiles(planInput)
    if (planFiles.length === 0) {
      throw new Error(`no plan files matched: ${planInput}`)
    }
    core.info(`Evaluating ${planFiles.length} plan file(s) against ${config.rules.length} rule(s).`)

    const results: PlanResult[] = planFiles.map((file) => {
      const content = fs.readFileSync(file, 'utf8')
      const plan = parsePlan(content)
      const evaluation = evaluatePlan(plan, config.rules)
      core.info(
        `  ${file}: ${evaluation.matched ? `matched "${evaluation.matchedRule}"` : 'no match'}`
      )
      return { file, evaluation }
    })

    const approved = results.every((r) => r.evaluation.matched)

    const matchedRules: Record<string, string | null> = {}
    for (const r of results) {
      matchedRules[r.file] = r.evaluation.matchedRule
    }

    if (approved) {
      const octokit = github.getOctokit(token)
      const { owner, repo } = github.context.repo
      const pullNumber = getPullNumber()
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      })
      await approvePullRequest({
        octokit,
        owner,
        repo,
        pullNumber,
        headSha: pr.head.sha,
        body: approveMessage,
      })
    } else {
      core.info('Not all plans matched a rule; skipping approval (human review required).')
    }

    core.setOutput('approved', String(approved))
    core.setOutput('matched-rules', JSON.stringify(matchedRules))
    await writeSummary(results, approved)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

run()
