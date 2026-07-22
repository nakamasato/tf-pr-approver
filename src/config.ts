/**
 * Loads and validates the declarative rules config
 * (default: `.github/tf-pr-approver.yml`).
 */
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { z } from 'zod'

const ActionEnum = z.enum(['no-op', 'create', 'read', 'update', 'delete'])

const ConditionsSchema = z
  .object({
    /** All resource changes must be no-op (terraform plan shows "No changes"). */
    no_changes: z.boolean().optional(),
    /** Actions appearing in the plan must be a subset of this list (no-op/read always allowed). */
    allowed_actions: z.array(ActionEnum).nonempty().optional(),
    /** The plan must not contain any of these actions. */
    denied_actions: z.array(ActionEnum).nonempty().optional(),
    /** Every changed resource must have a type in this list. */
    allowed_resource_types: z.array(z.string().min(1)).nonempty().optional(),
    /** No changed resource may have a type in this list. */
    denied_resource_types: z.array(z.string().min(1)).nonempty().optional(),
  })
  .strict()
  .refine((obj) => Object.values(obj).some((v) => v !== undefined), {
    message: 'each rule "when" must specify at least one condition',
  })

const RuleSchema = z
  .object({
    name: z.string().min(1),
    when: ConditionsSchema,
  })
  .strict()

const ConfigSchema = z
  .object({
    /**
     * Files/directories the PR is allowed to touch. If the PR changes anything
     * outside this list, approval is skipped before the plan is even evaluated.
     * Omitting it disables the scope gate (every changed file is in scope).
     */
    target_paths: z.array(z.string().min(1)).nonempty().optional(),
    rules: z.array(RuleSchema).nonempty(),
  })
  .strict()

export type Conditions = z.infer<typeof ConditionsSchema>
export type Rule = z.infer<typeof RuleSchema>
export type Config = z.infer<typeof ConfigSchema>

/** Parse a config object (already loaded from YAML/JSON). Exposed for testing. */
export function parseConfig(data: unknown): Config {
  const result = ConfigSchema.safeParse(data)
  if (!result.success) {
    const details = result.error.issues
      .map((i) => ` - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`invalid config:\n${details}`)
  }
  return result.data
}

/** Load and validate the config file at `path`. */
export function loadConfig(path: string): Config {
  if (!fs.existsSync(path)) {
    throw new Error(`config file not found: ${path}`)
  }
  const raw = fs.readFileSync(path, 'utf8')
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (e) {
    throw new Error(`config file is not valid YAML (${path}): ${(e as Error).message}`)
  }
  try {
    return parseConfig(parsed)
  } catch (e) {
    throw new Error(`${(e as Error).message}\n(in ${path})`)
  }
}
