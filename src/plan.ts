/**
 * Minimal typings and parsing for the Terraform plan JSON
 * (`terraform show -json <planfile>`).
 *
 * We only model the fields this action needs (resource-level change actions);
 * the real document has many more fields which we intentionally ignore.
 */

export type TfAction = 'no-op' | 'create' | 'read' | 'update' | 'delete'

export interface ResourceChange {
  address: string
  type: string
  name: string
  change: {
    actions: TfAction[]
  }
}

export interface TerraformPlan {
  resource_changes?: ResourceChange[]
}

/**
 * Parse a terraform plan JSON string into a {@link TerraformPlan}.
 * Throws on malformed input so the caller can fail the job (misconfiguration),
 * as opposed to treating it as a "conditions not met" skip.
 */
export function parsePlan(content: string): TerraformPlan {
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch (e) {
    throw new Error(`plan file is not valid JSON: ${(e as Error).message}`)
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('plan JSON must be an object')
  }

  const resourceChanges = (json as { resource_changes?: unknown }).resource_changes
  if (resourceChanges !== undefined && !Array.isArray(resourceChanges)) {
    throw new Error('plan JSON "resource_changes" must be an array')
  }

  return json as TerraformPlan
}
