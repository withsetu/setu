/** Pure helpers over the declared collection set (#253 increment C). Kept out of the
 *  provider so they can be unit-tested without React — see
 *  apps/admin/test/collections.test.ts. */

export interface CollectionDescriptor {
  name: string
  label: string
  labelPlural: string
  taxonomies: string[]
}

/** What the admin assumes before `/api/collections` answers, and what it falls back to if
 *  that read fails. Mirrors `DEFAULT_COLLECTIONS` in packages/core and the API's
 *  FALLBACK_CONFIG, so an offline or degraded admin still shows the two built-ins rather
 *  than an empty sidebar. */
export const BUILT_IN_COLLECTIONS: CollectionDescriptor[] = [
  {
    name: 'post',
    label: 'Post',
    labelPlural: 'Posts',
    taxonomies: ['category', 'tag']
  },
  { name: 'page', label: 'Page', labelPlural: 'Pages', taxonomies: [] }
]

/** Routes that predate declared collections. They stay as-is for URL stability: existing
 *  links, bookmarks, command-palette entries and e2e specs all address `/posts` and
 *  `/pages`. Every other declared collection is served by `/content/<name>`. */
const LEGACY_PATHS: Record<string, string> = {
  post: '/posts',
  page: '/pages'
}

export function pathForCollection(name: string): string {
  return LEGACY_PATHS[name] ?? `/content/${name}`
}

/** Collections that need a generic `/content/:collection` route — i.e. everything the
 *  admin does not already have a hand-written screen route for. */
export function dynamicCollections(
  collections: CollectionDescriptor[]
): CollectionDescriptor[] {
  return collections.filter((c) => LEGACY_PATHS[c.name] === undefined)
}

export function findCollection(
  collections: CollectionDescriptor[],
  name: string | undefined
): CollectionDescriptor | undefined {
  return name === undefined
    ? undefined
    : collections.find((c) => c.name === name)
}

/** Does this collection participate in the given taxonomy? Replaces the hardcoded
 *  `collection === 'post'` check the MetaPanel carried, per the generalize-HERE note it
 *  left behind. An unknown collection participates in nothing — fail closed, so a
 *  taxonomy field is never offered for a type that never declared it. */
export function collectionHasTaxonomy(
  collections: CollectionDescriptor[],
  name: string,
  taxonomy: 'category' | 'tag'
): boolean {
  return (
    findCollection(collections, name)?.taxonomies.includes(taxonomy) ?? false
  )
}
