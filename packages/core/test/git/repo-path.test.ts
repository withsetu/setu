import { describe, it, expect } from 'vitest'
import { isGitDirSegment, hasGitDirSegment } from '../../src/git/repo-path'

// #1154: a repo path segment that names (or a filesystem resolves onto) the repository's own
// VCS directory must never be writable through the CMS. The rule mirrors the spellings git itself
// refuses in a tree (core.protectHFS / core.protectNTFS), because those are exactly the names a
// case-folding or name-normalizing filesystem resolves onto `.git`.
describe('isGitDirSegment (#1154)', () => {
  it.each([
    '.git',
    '.GIT',
    '.Git',
    '.gIt',
    '.git.', // NTFS strips trailing dots
    '.git ', // ...and trailing spaces
    '.git. . ',
    'git~1', // NTFS 8.3 short name
    'GIT~1',
    '.git::$INDEX_ALLOCATION', // NTFS alternate data stream
    '.g‌it', // HFS+ ignores default-ignorable code points
    '​.git',
    '.ǵit'.normalize('NFD').replace('́', '') // decomposed then stripped → .git
  ])('refuses %j', (seg) => {
    expect(isGitDirSegment(seg)).toBe(true)
  })

  it.each([
    'git',
    '.github',
    '.gitignore',
    '.gitkeep',
    'git~2',
    'content',
    '.git-foo',
    'x.git',
    'café'
  ])('admits %j', (seg) => {
    expect(isGitDirSegment(seg)).toBe(false)
  })
})

describe('hasGitDirSegment (#1154)', () => {
  it.each([
    '.git/config',
    '.GIT/x',
    'content/.git/en/x.mdoc',
    'content/blog/en/.Git',
    'a\\.git\\hooks\\pre-commit' // backslash is a separator on Windows
  ])('refuses %j', (p) => {
    expect(hasGitDirSegment(p)).toBe(true)
  })

  it.each([
    'content/post/en/hello.mdoc',
    'settings.json',
    '.github/workflows/ci.yml',
    'content/blog/en/git.mdoc'
  ])('admits %j', (p) => {
    expect(hasGitDirSegment(p)).toBe(false)
  })
})
