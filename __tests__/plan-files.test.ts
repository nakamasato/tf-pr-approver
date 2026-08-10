import { describe, expect, it } from 'vitest'
import { hasEmptyPathSegment, parsePlanFilesInput } from '../src/plan-files'

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

describe('hasEmptyPathSegment', () => {
  it('flags a pattern whose middle segment is empty', () => {
    // `tfplans/${{ needs.x.outputs.tfplan_artifact_name }}/tfplan.json` with a
    // skipped plan job. @actions/glob collapses the "//", so the pattern would
    // silently resolve to a different, unrelated plan file.
    expect(hasEmptyPathSegment('tfplans//tfplan.json')).toBe(true)
  })

  it('flags a pattern ending in a separator', () => {
    // Same cause, expression at the end: `tfplans/${{ ... }}` becomes `tfplans/`.
    // A plan file is a file, so a trailing separator can never be intentional.
    expect(hasEmptyPathSegment('tfplans/')).toBe(true)
  })

  it('flags several consecutive separators', () => {
    expect(hasEmptyPathSegment('tfplans///tfplan.json')).toBe(true)
  })

  it('accepts an ordinary relative glob', () => {
    expect(hasEmptyPathSegment('tfplans/**/tfplan.json')).toBe(false)
  })

  it('accepts an absolute path', () => {
    expect(hasEmptyPathSegment('/home/runner/work/tfplans/tfplan.json')).toBe(false)
  })

  it('accepts a leading "//" so a Windows UNC root still works', () => {
    expect(hasEmptyPathSegment('//host/share/tfplan.json')).toBe(false)
  })
})
