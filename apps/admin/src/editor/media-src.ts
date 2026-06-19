/** Resolve a stored image src for display: prepend the configured media origin to a
 *  root-relative `/uploads/…` path; leave absolute (http/https) or empty srcs alone. */
export function resolveMediaSrc(src: string, base: string | undefined): string {
  if (!src || /^https?:\/\//i.test(src)) return src
  if (src.startsWith('/')) return `${(base ?? 'http://localhost:4444').replace(/\/+$/, '')}${src}`
  return src
}
