import {
  resolvePermalink,
  type PermalinkOptions,
  type PermalinkRef
} from './resolve'

export interface PermalinkEntry extends PermalinkRef {
  /** Content id ("collection/locale/slug") — the map key. */
  id: string
}

export interface PermalinkMapResult {
  paths: Map<string, string>
  warnings: string[]
}

export interface PermalinkMapOptions extends PermalinkOptions {
  /** The paths these ids ALREADY hold — the previous build's committed `url-map`,
   *  keyed by the same id as {@link PermalinkEntry.id} and in the same shape the map
   *  returns (no leading slash; the site root is `''`). Incumbency is the first
   *  tiebreak: an id still resolving to the same base path keeps the exact path it
   *  holds, so a newly added entry can never take a live URL no matter its date (#657). */
  incumbent?: Map<string, string> | Record<string, string>
}

const byIdAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const lookup = (
  map: NonNullable<PermalinkMapOptions['incumbent']>,
  id: string
): string | undefined =>
  map instanceof Map
    ? map.get(id)
    : Object.prototype.hasOwnProperty.call(map, id)
      ? map[id]
      : undefined

/** Does `held` still belong to `base` — either the clean path itself or one of its
 *  `-2`/`-3`/… disambiguated forms? If the entry's own slug/pattern/date changed, its
 *  base changed with it and the old path is no longer its to keep (a rename must move). */
function holdsBase(held: string, base: string): boolean {
  if (held === base) return true
  if (!held.startsWith(`${base}-`)) return false
  return /^\d+$/.test(held.slice(base.length + 1))
}

/** Resolve the whole site's URLs at once, disambiguating collisions deterministically.
 *  Incumbency first: any id already holding a path (`opts.incumbent`) whose base path is
 *  unchanged keeps it. Unclaimed entries then compete in date order — oldest (frontmatter
 *  date asc; date-less last; id tiebreak) takes the clean URL, the rest get -2/-3/… on the
 *  final segment. Adding a new colliding entry never moves an existing entry's URL, even
 *  when the newcomer is back-dated (#657). Pure. */
export function resolvePermalinkMap(
  entries: PermalinkEntry[],
  patternFor: (collection: string) => string,
  opts: PermalinkMapOptions = {}
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

  // Pass 1 — incumbents. Iterated in the same deterministic order so that if two ids
  // both claim one path (a corrupt/stale snapshot), the older keeps it and the other
  // falls through to the competition below rather than being silently double-granted.
  if (opts.incumbent) {
    for (const e of order) {
      const held = lookup(opts.incumbent, e.id)
      if (held === undefined || taken.has(held)) continue
      if (!holdsBase(held, e.path)) continue
      taken.add(held)
      paths.set(e.id, held)
    }
  }

  // Pass 2 — everything unclaimed competes by date.
  for (const e of order) {
    if (paths.has(e.id)) continue
    let candidate = e.path
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${e.path}-${n}`
    if (candidate !== e.path)
      warnings.push(
        `URL collision: ${e.id} → "${e.path}" is already used; serving it at "${candidate}"`
      )
    taken.add(candidate)
    paths.set(e.id, candidate)
  }
  return { paths, warnings }
}

/** Translate the committed `url-map.json` — keyed by stable content id (`cid`), values
 *  leading-slash-normalized with the site root as `"/"` — into the entry-id-keyed,
 *  slash-free shape {@link PermalinkMapOptions.incumbent} expects. Entries with no `cid`
 *  (not yet stamped) or no snapshot entry simply don't claim anything. Pure. */
export function incumbentFromUrlMap(
  urlMap: Record<string, string> | null | undefined,
  entries: { id: string; cid?: string | null }[]
): Map<string, string> {
  const out = new Map<string, string>()
  if (!urlMap || typeof urlMap !== 'object') return out
  for (const e of entries) {
    if (!e.cid) continue
    const held = urlMap[e.cid]
    if (typeof held !== 'string') continue
    out.set(e.id, held === '/' ? '' : held.replace(/^\//, ''))
  }
  return out
}
