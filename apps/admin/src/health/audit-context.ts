import { parseMdoc, parseContentPath, type AuditEntry } from '@setu/core'
import type { GitPort } from '@setu/core'

const COLLECTIONS = ['post', 'page']

/** The site's published content = committed .mdoc files (drafts live only in the DB), minus
 *  entries explicitly marked `published: false`. Mirrors what the site build sees. */
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
      out.push({ id: `${ref.collection}/${ref.locale}/${ref.slug}`, data: frontmatter, body })
    }
  }
  return out
}
