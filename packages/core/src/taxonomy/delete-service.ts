import type { GitPort } from '../git/git-port'
import type { GitAuthor, FileChange } from '../git/types'
import type { DataPort } from '../data/data-port'
import type { EntryRef } from '../data/types'
import type { ReadService } from '../read/types'
import type { IndexService } from '../index-port/index-service'
import type { TiptapDoc } from '../markdoc/types'
import type { Category } from './types'
import { parseCategories, serializeCategories } from './parse'
import { removeCategory } from './ops'
import { removeCategory as stripCategoryFromMeta } from '../bulk/mutations'
import { rawFrontmatterOf, serializeMdoc } from '../markdoc/frontmatter'
import { tiptapToMarkdoc } from '../markdoc/to-markdoc'
import { contentPath } from '../publish/content-path'
import { TAXONOMY_PATH } from './service'

export interface CategoryDeleterDeps {
  git: GitPort
  data: DataPort
  read: ReadService
  index: IndexService
  author: GitAuthor
}

/** One referencing entry the strip could not rewrite (#713/#714b). It keeps a
 *  DANGLING reference to the deleted category slug, so this is reported to the
 *  caller rather than swallowed — see the try/catch in `remove`. */
export interface CategoryStripSkip {
  ref: EntryRef
  message: string
}

/** Delete a category atomically: strip its slug from every referencing entry's
 *  frontmatter AND remove its definition (promoting children one level up) in a
 *  SINGLE commit. Then reindex the touched entries so counts/listing stay fresh. */
export function createCategoryDeleter(deps: CategoryDeleterDeps) {
  const { git, data, read, index, author } = deps

  return {
    async remove(slug: string): Promise<{
      categories: Category[]
      strippedCount: number
      /** Entries that still reference `slug` because they could not be rewritten. */
      skipped: CategoryStripSkip[]
    }> {
      // 1. Load current taxonomy and compute the next state (throws if slug absent)
      const cats = parseCategories((await git.readFile(TAXONOMY_PATH)) ?? '')
      const nextCats = removeCategory(cats, slug)

      // 2. Find every entry that references this category slug
      const refs = await index.entriesByCategory(slug)
      const changes: FileChange[] = []
      const pending: {
        ref: (typeof refs)[number]
        content: TiptapDoc
        next: Record<string, unknown>
        serialized: string
      }[] = []

      const skipped: CategoryStripSkip[] = []

      for (const ref of refs) {
        const loaded = await read.loadForEdit(ref)
        if (loaded.source === 'absent') continue
        const draft = loaded.draft
        // #713/#714b: this loop serializes EVERY entry referencing the category, so one
        // unserializable stored draft threw and the whole delete failed — the category
        // stayed, no entry was stripped, and the user saw a raw error. Scope it to the
        // entry. The trade is explicit: the category IS removed, so a skipped entry is
        // left holding a dangling slug. That is strictly better than a delete that can
        // never succeed, but it is only acceptable because it is REPORTED — a silent
        // skip here would be the same quiet-drift class #665/#670 were closing.
        let next: Record<string, unknown>
        let serialized: string
        let path: string
        try {
          next = stripCategoryFromMeta(draft.metadata, slug)
          serialized = serializeMdoc({
            frontmatter: next,
            body: tiptapToMarkdoc(draft.content),
            // #666: stripping one category must not reformat the rest of the frontmatter.
            rawFrontmatter: rawFrontmatterOf(draft.baseContent)
          })
          path = contentPath(ref)
        } catch (err) {
          skipped.push({
            ref,
            message: err instanceof Error ? err.message : String(err)
          })
          continue
        }
        changes.push({ path, content: serialized })
        pending.push({ ref, content: draft.content, next, serialized })
      }

      // 3. Include the taxonomy file update in the same set of changes
      changes.push({
        path: TAXONOMY_PATH,
        content: serializeCategories(nextCats)
      })

      // 4. Single atomic commit: all content strips + taxonomy update together
      const { sha } = await git.commitFiles({
        changes,
        message: `taxonomy: delete category ${slug} (strip from ${pending.length} entr${pending.length === 1 ? 'y' : 'ies'})`,
        author
      })

      // 5. Post-commit: update drafts and reindex so counts/listing stay fresh
      for (const p of pending) {
        await data.saveDraft({
          ...p.ref,
          content: p.content,
          metadata: p.next,
          baseSha: sha,
          baseContent: p.serialized
        })
      }
      // Reindex every entry this atomic commit changed, then mark the index synced at the
      // commit sha so ensureBuilt's out-of-band sha-gate doesn't full-rebuild on the next
      // load (reindexEntry does not advance indexedSha itself). One call so the stamp
      // cannot land after a failed reindex (#655) — this loop was already the correct
      // posture, and is now the shared one.
      await index.reindexEntries(
        pending.map((p) => p.ref),
        sha
      )

      return { categories: nextCats, strippedCount: pending.length, skipped }
    }
  }
}
