/**
 * Single source of truth for the childless "atom" content blocks — Markdoc tags that
 * carry props but no body ({% hero /%}, {% gallery /%}, …). Both markdoc converters are
 * driven from this ONE map so the two directions can never drift: previously each atom
 * was hand-maintained twice (a `case` arm in to-markdoc + a mirror `if` in to-tiptap),
 * and a typo'd node name serialized one-way and silently corrupted round-trip.
 *
 * Scope — atoms ONLY. Excluded on purpose:
 *  - Body-bearing tags (callout, columns, column, setuBlock) carry CHILDREN and have
 *    bespoke serialization — they stay in the converters.
 *  - String-serialized blocks (imageBlock, table, passthrough) have no faithful native
 *    Markdoc AST form and go through custom string serializers — also not atoms.
 */

/** Markdoc tag name → Tiptap node type, for the childless atom blocks. */
export const ATOM_TAG_TO_NODE: Record<string, string> = {
  contact: 'contactBlock',
  hero: 'heroBlock',
  gallery: 'galleryBlock',
  spacer: 'spacerBlock',
  video: 'videoBlock',
  query: 'queryBlock',
  'latest-posts': 'latestPostsBlock',
  embed: 'embedBlock'
}

/** The reverse lookup (Tiptap node type → Markdoc tag name), derived from
 *  {@link ATOM_TAG_TO_NODE} so the bijection has exactly one authored side. */
export const ATOM_NODE_TO_TAG: Record<string, string> = Object.fromEntries(
  Object.entries(ATOM_TAG_TO_NODE).map(([tag, node]) => [node, tag])
)
