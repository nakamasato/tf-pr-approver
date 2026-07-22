import { describe, expect, it } from 'vitest'
import { checkChangedFiles, isTargetPath } from '../src/paths'

describe('isTargetPath', () => {
  it('matches a glob pattern', () => {
    expect(isTargetPath('terraform/main.tf', { include: ['terraform/**'] })).toBe(true)
    expect(isTargetPath('terraform/a/b/main.tf', { include: ['terraform/**'] })).toBe(true)
    expect(isTargetPath('app/main.go', { include: ['terraform/**'] })).toBe(false)
  })

  it('treats a plain path as both a file and a directory prefix', () => {
    expect(isTargetPath('docs/guide.md', { include: ['docs'] })).toBe(true)
    expect(isTargetPath('docs/a/b.md', { include: ['docs/'] })).toBe(true)
    expect(isTargetPath('README.md', { include: ['README.md'] })).toBe(true)
    expect(isTargetPath('README.md.bak', { include: ['README.md'] })).toBe(false)
    // a sibling directory sharing the prefix must not match
    expect(isTargetPath('docsite/index.md', { include: ['docs'] })).toBe(false)
  })

  it('matches extension patterns anywhere in the tree', () => {
    expect(isTargetPath('a/b/c.md', { include: ['**/*.md'] })).toBe(true)
    expect(isTargetPath('c.md', { include: ['**/*.md'] })).toBe(true)
    expect(isTargetPath('a/b/c.tf', { include: ['**/*.md'] })).toBe(false)
  })

  it('matches dotfiles and dot directories', () => {
    expect(isTargetPath('.github/workflows/ci.yml', { include: ['.github/**'] })).toBe(true)
    expect(isTargetPath('.github/workflows/ci.yml', { include: ['**'] })).toBe(true)
  })

  it('normalizes a leading "./" in patterns', () => {
    expect(isTargetPath('docs/guide.md', { include: ['./docs/**'] })).toBe(true)
  })

  it('does not treat a leading "!" as a negation that widens the scope', () => {
    // With minimatch's default `negate` handling, `!docs/**` matches everything
    // that is *not* under docs/, which would silently disable the scope gate.
    // `config.ts` rejects such patterns; this keeps the pure function safe too.
    expect(isTargetPath('app/main.go', { include: ['!docs/**'] })).toBe(false)
    expect(isTargetPath('terraform/main.tf', { include: ['terraform/**', '!docs/**'] })).toBe(true)
  })

  it('returns false when there are no include patterns', () => {
    expect(isTargetPath('docs/guide.md', { include: [] })).toBe(false)
    expect(isTargetPath('docs/guide.md', {})).toBe(false)
  })
})

describe('isTargetPath with exclude', () => {
  it('carves a subtree back out of an include pattern', () => {
    const targets = { include: ['terraform/**'], exclude: ['terraform/prod/**'] }
    expect(isTargetPath('terraform/dev/main.tf', targets)).toBe(true)
    expect(isTargetPath('terraform/prod/main.tf', targets)).toBe(false)
  })

  it('lets exclude win regardless of the order of the two lists', () => {
    // Deny-wins is order-independent: unlike a flat list of `!` patterns, no
    // arrangement of the same patterns can produce a different verdict.
    expect(isTargetPath('terraform/prod/main.tf', {
      include: ['terraform/**', 'terraform/prod/main.tf'],
      exclude: ['terraform/prod/**'],
    })).toBe(false)
  })

  it('ignores an exclude pattern that nothing in include matches', () => {
    const targets = { include: ['terraform/**'], exclude: ['app/**'] }
    expect(isTargetPath('terraform/main.tf', targets)).toBe(true)
    expect(isTargetPath('app/main.go', targets)).toBe(false)
  })

  it('never widens the scope: adding an exclude only ever removes files', () => {
    const files = ['terraform/main.tf', 'terraform/prod/main.tf', 'docs/a.md', 'app/main.go']
    const before = files.filter((f) => isTargetPath(f, { include: ['terraform/**'] }))
    const after = files.filter((f) =>
      isTargetPath(f, { include: ['terraform/**'], exclude: ['terraform/prod/**'] })
    )
    expect(after.every((f) => before.includes(f))).toBe(true)
    expect(after.length).toBeLessThan(before.length)
  })
})

describe('checkChangedFiles', () => {
  const targets = { include: ['terraform/**', 'docs/**'] }

  it('passes when every changed file is in scope', () => {
    const res = checkChangedFiles(['terraform/main.tf', 'docs/guide.md'], targets)
    expect(res.matched).toBe(true)
    expect(res.outOfScopeFiles).toEqual([])
  })

  it('fails and reports every out-of-scope file', () => {
    const res = checkChangedFiles(['terraform/main.tf', 'app/main.go', 'package.json'], targets)
    expect(res.matched).toBe(false)
    expect(res.outOfScopeFiles).toEqual(['app/main.go', 'package.json'])
  })

  it('passes for a docs-only change', () => {
    const res = checkChangedFiles(['docs/a.md', 'docs/b.md'], targets)
    expect(res.matched).toBe(true)
  })

  it('passes when the PR changes no files at all', () => {
    expect(checkChangedFiles([], targets).matched).toBe(true)
  })

  it('reports an excluded file as out of scope', () => {
    const res = checkChangedFiles(['terraform/dev/a.tf', 'terraform/prod/b.tf'], {
      include: ['terraform/**'],
      exclude: ['terraform/prod/**'],
    })
    expect(res.matched).toBe(false)
    expect(res.outOfScopeFiles).toEqual(['terraform/prod/b.tf'])
  })
})

describe('checkChangedFiles with exclude but no include (fail-closed)', () => {
  // An `exclude` written without an `include` declares no scope at all. It must
  // put *nothing* in scope — reading it as "everything except these" would turn
  // an incomplete config into a blanket auto-approval.
  const excludeOnly = { exclude: ['app/**'] }

  it('puts no file in scope, so nothing is ever approved', () => {
    const res = checkChangedFiles(['terraform/main.tf', 'docs/a.md'], excludeOnly)
    expect(res.matched).toBe(false)
    expect(res.outOfScopeFiles).toEqual(['terraform/main.tf', 'docs/a.md'])
  })

  it('rejects even a file that the exclude list does not mention', () => {
    expect(isTargetPath('terraform/main.tf', excludeOnly)).toBe(false)
  })

  it('rejects the excluded files themselves', () => {
    const res = checkChangedFiles(['app/main.go'], excludeOnly)
    expect(res.matched).toBe(false)
    expect(res.outOfScopeFiles).toEqual(['app/main.go'])
  })
})
