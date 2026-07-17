/** Frontmatter builder for seeded posts (#512). Emits ONLY keys the product
 *  reads (plus the forward-compatible `author`, #142):
 *  - `cid`: stable content id (uuid) — stamped like the publish path does
 *  - `title`, `date` (ISO)
 *  - `published: false` for drafts — the repo's ONLY draft signal (there is no
 *    `status: draft` concept; see CLAUDE.md §1 / failure mode #19)
 *  - `categories` / `tags`: slug arrays
 *  - `featuredImage`: root-relative `/media/<key>.<ext>` (matches uploads)
 *  - `author`: the owning demo user's email. NOTHING reads this yet — the
 *    content model has no author field until #142; it is stamped so seeded
 *    content becomes attributable the moment #142 lands (documented known
 *    limitation, not a hidden feature). Git commit authorship carries the
 *    owner identity today. */

export interface PostFrontmatterInput {
  cid: string
  title: string
  /** ISO 8601. */
  date: string
  draft: boolean
  /** Category slugs (already registered in taxonomy/categories.yaml). */
  categories: readonly string[]
  /** Normalized tag slugs. */
  tags: readonly string[]
  /** Root-relative media path (e.g. `/media/2026/07/foo.jpg`), when the
   *  featured image was actually ingested. */
  featuredImage?: string
  /** Owning demo user's email. */
  authorEmail: string
}

export function buildPostFrontmatter(
  input: PostFrontmatterInput
): Record<string, unknown> {
  return {
    cid: input.cid,
    title: input.title,
    date: input.date,
    ...(input.draft ? { published: false } : {}),
    ...(input.categories.length > 0
      ? { categories: [...input.categories] }
      : {}),
    ...(input.tags.length > 0 ? { tags: [...input.tags] } : {}),
    ...(input.featuredImage !== undefined
      ? { featuredImage: input.featuredImage }
      : {}),
    author: input.authorEmail
  }
}
