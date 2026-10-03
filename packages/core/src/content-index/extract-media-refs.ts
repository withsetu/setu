// Pure, edge-safe. Scans a serialized doc string for /media/<key> references
// (image blocks, inline images, frontmatter cover images — any embedded URL) and
// normalizes each to its bare mediaKey (no extension, no variant suffix: `.<width>w` for media
// stored since #1159, `-<width>w` for media stored before it).
const MEDIA_REF = /\/media\/([A-Za-z0-9][A-Za-z0-9._/-]*)/g

function normalize(raw: string): string {
  const base = raw.replace(/\.[^./]+$/, '')
  // A `.<w>w` suffix is unambiguous (a mediaKey never contains a dot), so when present it is the
  // whole story — `cat-400w.800w.webp` is a variant of `cat-400w`, not of `cat`.
  if (/\.\d+w$/.test(base)) return base.replace(/\.\d+w$/, '')
  return base.replace(/-\d+w$/, '')
}

export function extractMediaRefs(body: string): string[] {
  const out = new Set<string>()
  for (const m of body.matchAll(MEDIA_REF)) out.add(normalize(m[1]!))
  return [...out]
}
