// Pure, edge-safe. Scans a serialized doc string for /media/<key> references
// (image blocks, inline images, frontmatter cover images — any embedded URL) and
// normalizes each to its bare mediaKey (no extension, no -<width>w variant suffix).
const MEDIA_REF = /\/media\/([A-Za-z0-9][A-Za-z0-9._/-]*)/g

function normalize(raw: string): string {
  return raw.replace(/\.[^./]+$/, '').replace(/-\d+w$/, '')
}

export function extractMediaRefs(body: string): string[] {
  const out = new Set<string>()
  for (const m of body.matchAll(MEDIA_REF)) out.add(normalize(m[1]!))
  return [...out]
}
