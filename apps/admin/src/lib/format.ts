export function greeting(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Human duration for an elapsed/run time (#571): `9s`, `47s`, `1m 04s`.
 *  Clamped at zero — a server-clock start time can read slightly ahead of ours. */
export function formatDuration(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000))
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
}

export function relativeTime(
  updatedAt: number | null,
  now: number = Date.now()
): string {
  if (updatedAt === null) return '—'
  const mins = Math.max(0, Math.round((now - updatedAt) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
