import { parseMdoc, parseContentPath, type AuditEntry } from '@setu/core'
import type { GitPort } from '@setu/core'

const COLLECTIONS = ['post', 'page']

/** Committed .mdoc files (drafts live only in the DB), intentionally EXCLUDING entries
 *  marked `published: false`. Audits what should be visible to the public — not a mirror
 *  of the site build, which currently renders all committed entries regardless of the flag. */
export async function loadAuditEntries(git: GitPort): Promise<AuditEntry[]> {
  const out: AuditEntry[] = []
  for (const collection of COLLECTIONS) {
    for (const path of await git.list(`content/${collection}/`)) {
      const ref = parseContentPath(path)
      if (ref === null) continue
      const raw = await git.readFile(path)
      if (raw === null) continue
      const { frontmatter, body } = parseMdoc(raw)
      if (frontmatter.published === false) continue
      out.push({
        id: `${ref.collection}/${ref.locale}/${ref.slug}`,
        data: frontmatter,
        body
      })
    }
  }
  return out
}
