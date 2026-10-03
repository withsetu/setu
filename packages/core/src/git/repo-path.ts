import { unicodeCaseFold } from '../rename/slug'

/** Code points HFS+ drops when comparing names (git's `is_hfs_dotgit` skips the same class), so
 *  `.g<ZWNJ>it` is the repository's own `.git` on such a volume. */
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu

/** True iff one path segment names — or a filesystem would resolve onto — the repository's VCS
 *  directory. Rejects the CLASS git itself refuses in a tree (core.protectHFS/protectNTFS):
 *    - any case-folding of `.git` (`unicodeCaseFold`, the same fold the API write gate uses);
 *    - HFS+ default-ignorable code points inside the name;
 *    - NTFS trailing dots/spaces, an alternate-data-stream suffix (`.git::$INDEX_ALLOCATION`),
 *      and the 8.3 short name `git~1`.
 *  Over-rejection here costs a file name nobody legitimately writes through the CMS; an
 *  under-rejection is a write into the VCS internals. Enforced by
 *  packages/core/test/git/repo-path.test.ts. */
export function isGitDirSegment(segment: string): boolean {
  let s = unicodeCaseFold(segment).replace(DEFAULT_IGNORABLE, '')
  const colon = s.indexOf(':')
  if (colon !== -1) s = s.slice(0, colon)
  s = s.replace(/[. ]+$/, '')
  return s === '.git' || s === 'git~1'
}

/** True iff any segment of `path` is a VCS-directory segment (`isGitDirSegment`). Splits on BOTH
 *  `/` and `\` — the latter is a separator on Windows — so the check never depends on the host's
 *  path syntax. Enforced by packages/core/test/git/repo-path.test.ts. */
export function hasGitDirSegment(path: string): boolean {
  return path.split(/[/\\]/).some(isGitDirSegment)
}
