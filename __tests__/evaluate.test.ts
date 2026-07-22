import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'
import { evaluatePlan } from '../src/evaluate'
import { parsePlan } from '../src/plan'
import { Rule } from '../src/config'

function fixture(name: string): ReturnType<typeof parsePlan> {
  const p = path.join(__dirname, 'fixtures', name)
  return parsePlan(fs.readFileSync(p, 'utf8'))
}

const noChangesRule: Rule = { name: 'no-changes', when: { no_changes: true } }
const safeUpdatesRule: Rule = {
  name: 'safe-updates-only',
  when: {
    denied_actions: ['delete'],
    allowed_actions: ['update'],
    allowed_resource_types: ['aws_s3_bucket_policy'],
  },
}

describe('evaluatePlan', () => {
  describe('no_changes', () => {
    it('matches a plan with only no-op / read actions', () => {
      const res = evaluatePlan(fixture('no-changes.json'), [noChangesRule])
      expect(res.matched).toBe(true)
      expect(res.matchedRule).toBe('no-changes')
    })

    it('does not match when a resource would change', () => {
      const res = evaluatePlan(fixture('update-only.json'), [noChangesRule])
      expect(res.matched).toBe(false)
      expect(res.matchedRule).toBeNull()
      expect(res.ruleEvaluations[0].reason).toContain('1 resource(s) would change')
    })

    it('matches an empty plan (no resource_changes field)', () => {
      const res = evaluatePlan({}, [noChangesRule])
      expect(res.matched).toBe(true)
    })
  })

  describe('allowed_actions / denied_actions / allowed_resource_types', () => {
    it('matches an update-only plan of allowed type', () => {
      const res = evaluatePlan(fixture('update-only.json'), [safeUpdatesRule])
      expect(res.matched).toBe(true)
      expect(res.matchedRule).toBe('safe-updates-only')
    })

    it('rejects a plan containing a denied action (delete)', () => {
      const res = evaluatePlan(fixture('with-delete.json'), [safeUpdatesRule])
      expect(res.matched).toBe(false)
      expect(res.ruleEvaluations[0].reason).toContain('denied action "delete"')
    })

    it('rejects a replace (delete+create) under update-only allowed_actions', () => {
      const res = evaluatePlan(fixture('replace.json'), [
        { name: 'update-only', when: { allowed_actions: ['update'] } },
      ])
      expect(res.matched).toBe(false)
    })

    it('rejects a changed resource whose type is not allowed', () => {
      const res = evaluatePlan(fixture('update-only.json'), [
        {
          name: 'only-iam',
          when: { allowed_actions: ['update'], allowed_resource_types: ['aws_iam_role'] },
        },
      ])
      expect(res.matched).toBe(false)
      expect(res.ruleEvaluations[0].reason).toContain('not in allowed_resource_types')
    })
  })

  describe('denied_resource_types', () => {
    it('rejects a change to a denied resource type', () => {
      const res = evaluatePlan(fixture('with-delete.json'), [
        { name: 'no-iam', when: { denied_resource_types: ['aws_iam_role'] } },
      ])
      expect(res.matched).toBe(false)
      expect(res.ruleEvaluations[0].reason).toContain('denied_resource_types')
    })
  })

  describe('OR across rules', () => {
    it('matches when any rule matches (first wins)', () => {
      const res = evaluatePlan(fixture('update-only.json'), [noChangesRule, safeUpdatesRule])
      expect(res.matched).toBe(true)
      expect(res.matchedRule).toBe('safe-updates-only')
      expect(res.ruleEvaluations).toHaveLength(2)
    })

    it('does not match when no rule matches', () => {
      const res = evaluatePlan(fixture('with-delete.json'), [noChangesRule, safeUpdatesRule])
      expect(res.matched).toBe(false)
      expect(res.matchedRule).toBeNull()
    })
  })
})
