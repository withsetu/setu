import Markdoc from '@markdoc/markdoc'

interface AstNode {
  type?: string
  tag?: string
  attributes?: Record<string, unknown>
  children?: AstNode[]
}

/** Scan a raw markdoc body for images missing alt text and the number of H1
 *  headings. Pure + edge-safe (Markdoc only) so BOTH the Site Health audit and
 *  the content-index projection can consume it without a layering cycle (#593):
 *  the index precomputes these facts per entry at build time so the audit never
 *  re-walks git per page. */
export function scanBody(body: string): {
  imagesWithoutAlt: number
  h1Count: number
} {
  let imagesWithoutAlt = 0
  let h1Count = 0
  const root = Markdoc.parse(body) as unknown as AstNode
  const walk = (node: AstNode | undefined): void => {
    if (!node) return
    const isMdImage = node.type === 'image'
    const isTagImage = node.type === 'tag' && node.tag === 'image'
    if (isMdImage || isTagImage) {
      const alt = node.attributes?.alt
      if (typeof alt !== 'string' || alt.trim() === '') imagesWithoutAlt++
    }
    if (node.type === 'heading' && node.attributes?.level === 1) h1Count++
    for (const c of node.children ?? []) walk(c)
  }
  walk(root)
  return { imagesWithoutAlt, h1Count }
}
