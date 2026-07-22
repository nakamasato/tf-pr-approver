import { describe, expect, it } from 'vitest'
import { checkChangedFiles, isTargetPath } from '../src/paths'

describe('isTargetPath', () => {
  it('matches a glob pattern', () => {
    expect(isTargetPath('terraform/main.tf', ['terraform/**'])).toBe(true)
    expect(isTargetPath('terraform/a/b/main.tf', ['terraform/**'])).toBe(true)
    expect(isTargetPath('app/main.go', ['terraform/**'])).toBe(false)
  })

  it('treats a plain path as both a file and a directory prefix', () => {
    expect(isTargetPath('docs/guide.md', ['docs'])).toBe(true)
    expect(isTargetPath('docs/a/b.md', ['docs/'])).toBe(true)
    expect(isTargetPath('README.md', ['README.md'])).toBe(true)
    expect(isTargetPath('README.md.bak', ['README.md'])).toBe(false)
    // a sibling directory sharing the prefix must not match
    expect(isTargetPath('docsite/index.md', ['docs'])).toBe(false)
  })

  it('matches extension patterns anywhere in the tree', () => {
    expect(isTargetPath('a/b/c.md', ['**/*.md'])).toBe(true)
    expect(isTargetPath('c.md', ['**/*.md'])).toBe(true)
    expect(isTargetPath('a/b/c.tf', ['**/*.md'])).toBe(false)
  })

  it('matches dotfiles and dot directories', () => {
    expect(isTargetPath('.github/workflows/ci.yml', ['.github/**'])).toBe(true)
    expect(isTargetPath('.github/workflows/ci.yml', ['**'])).toBe(true)
  })

  it('normalizes a leading "./" in patterns', () => {
    expect(isTargetPath('docs/guide.md', ['./docs/**'])).toBe(true)
  })

  it('returns false when there are no patterns', () => {
    expect(isTargetPath('docs/guide.md', [])).toBe(false)
  })
})

describe('checkChangedFiles', () => {
  const targets = ['terraform/**', 'docs/**']

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
})
