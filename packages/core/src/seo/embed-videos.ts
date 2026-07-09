import Markdoc from '@markdoc/markdoc'

/** The fields a Google `<video:video>` sitemap entry needs, sourced from a video embed block
 *  (#367). title / thumbnailUrl / playerLoc are required; description is optional. */
export interface EmbedVideo {
  title: string
  thumbnailUrl: string
  /** The embeddable player URL → `<video:player_loc>` (the embed block's stored `embedUrl`). */
  playerLoc: string
  description?: string
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined

/** Pull video embeds out of a markdoc body → the fields a `<video:video>` sitemap entry needs.
 *  Parses via Markdoc (so escaped quotes in titles survive — not a naive regex). Only
 *  `mediaType="video"` embeds carrying all three required fields are returned; anything missing
 *  one is skipped, since Google rejects incomplete `<video:video>` entries. Never throws. */
export function extractEmbedVideos(body: string): EmbedVideo[] {
  const out: EmbedVideo[] = []
  let ast
  try {
    ast = Markdoc.parse(body)
  } catch {
    return out
  }
  for (const node of ast.walk()) {
    if (node.type !== 'tag' || node.tag !== 'embed') continue
    const a = node.attributes
    if (str(a.mediaType) !== 'video') continue
    const title = str(a.title)
    const thumbnailUrl = str(a.thumbnailUrl)
    const playerLoc = str(a.embedUrl)
    if (!title || !thumbnailUrl || !playerLoc) continue
    const description = str(a.caption)
    out.push(
      description
        ? { title, thumbnailUrl, playerLoc, description }
        : { title, thumbnailUrl, playerLoc }
    )
  }
  return out
}
