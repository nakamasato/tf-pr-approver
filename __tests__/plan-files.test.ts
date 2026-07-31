import { describe, expect, it } from 'vitest'
import { parsePlanFilesInput } from '../src/plan-files'

describe('parsePlanFilesInput', () => {
  it('treats a plain line as an unnamed glob', () => {
    expect(parsePlanFilesInput('plans/*.json')).toEqual([{ name: null, pattern: 'plans/*.json' }])
  })

  it('parses newline-separated entries and ignores blank lines', () => {
    expect(parsePlanFilesInput('\n  plans/a.json  \n\nplans/b.json\n')).toEqual([
      { name: null, pattern: 'plans/a.json' },
      { name: null, pattern: 'plans/b.json' },
    ])
  })

  it('binds a name with "name=glob"', () => {
    expect(parsePlanFilesInput('sandbox = tfplans/tfplan-sandbox/tfplan.json')).toEqual([
      { name: 'sandbox', pattern: 'tfplans/tfplan-sandbox/tfplan.json' },
    ])
  })

  it('splits on the first "=" only, so a "=" in the path is harmless', () => {
    expect(parsePlanFilesInput('a=plans/x=y/tfplan.json')).toEqual([
      { name: 'a', pattern: 'plans/x=y/tfplan.json' },
    ])
  })

  it('keeps a bare glob containing "=" unnamed', () => {
    // The text before the first "=" contains "/", which a name never can, so
    // this is a path rather than a binding. Regression guard for configs that
    // predate the `name=glob` form.
    expect(parsePlanFilesInput('plans/x=y/tfplan.json')).toEqual([
      { name: null, pattern: 'plans/x=y/tfplan.json' },
    ])
  })

  it('rejects a name containing glob metacharacters', () => {
    expect(() => parsePlanFilesInput('pro*d=plans/a.json')).toThrow(/invalid plan name/)
  })

  it('rejects an empty name', () => {
    expect(() => parsePlanFilesInput('=plans/a.json')).toThrow(/invalid plan name/)
  })

  it('rejects a name with no pattern after "="', () => {
    expect(() => parsePlanFilesInput('sandbox=')).toThrow(/no glob pattern/)
  })

  it('rejects a duplicate name', () => {
    expect(() => parsePlanFilesInput('a=x.json\na=y.json')).toThrow(/duplicate plan name "a"/)
  })
})
