import { resolvePermalink, type PermalinkOptions, type PermalinkRef } from './resolve'

export interface PermalinkEntry extends PermalinkRef {
  /** Content id ("collection/locale/slug") — the map key. */
  id: string
}

export interface PermalinkMapResult {
  paths: Map<string, string>
  warnings: string[]
}

const byIdAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Resolve the whole site's URLs at once, disambiguating collisions deterministically:
 *  oldest entry (frontmatter date asc; date-less last; id tiebreak) keeps the clean URL,
 *  newer ones get -2/-3/… on the final segment. Adding a new colliding entry never moves
 *  an existing entry's URL. Pure. */
export function resolvePermalinkMap(
  entries: PermalinkEntry[],
  patternFor: (collection: string) => string,
  opts: PermalinkOptions = {}
): PermalinkMapResult {
  const warnings: string[] = []
  const resolved = entries.map((e) => {
    const r = resolvePermalink(e, patternFor(e.collection), opts)
    warnings.push(...r.warnings)
    return { id: e.id, date: e.date ?? null, path: r.path }
  })
  const order = [...resolved].sort((a, b) => {
    if (a.date === null && b.date === null) return byIdAsc(a.id, b.id)
    if (a.date === null) return 1
    if (b.date === null) return -1
    return a.date - b.date || byIdAsc(a.id, b.id)
  })
  const taken = new Set<string>()
  const paths = new Map<string, string>()
  for (const e of order) {
    let candidate = e.path
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${e.path}-${n}`
    if (candidate !== e.path)
      warnings.push(`URL collision: ${e.id} → "${e.path}" is already used; serving it at "${candidate}"`)
    taken.add(candidate)
    paths.set(e.id, candidate)
  }
  return { paths, warnings }
}
