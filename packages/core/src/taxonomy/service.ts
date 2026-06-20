import type { GitPort } from '../git/git-port'
import type { GitAuthor } from '../git/types'
import type { Category } from './types'
import { parseCategories, serializeCategories } from './parse'
import { addCategory, renameLabel as renameLabelOp, reparent as reparentOp } from './ops'

export const TAXONOMY_PATH = 'taxonomy/categories.yaml'

export interface TaxonomyService {
  read(): Promise<Category[]>
  create(input: { name: string; parent: string | null }): Promise<{ categories: Category[]; slug: string }>
  renameLabel(slug: string, name: string): Promise<Category[]>
  reparent(slug: string, parent: string | null): Promise<Category[]>
}

/** Git-backed category store. Each mutation reads the current file, applies a
 *  pure op, and commits the whole file — categories are shared infrastructure,
 *  committed immediately (not staged with a draft). */
export function createTaxonomyService(deps: { git: GitPort; author: GitAuthor }): TaxonomyService {
  const { git, author } = deps

  async function read(): Promise<Category[]> {
    const raw = await git.readFile(TAXONOMY_PATH)
    return parseCategories(raw ?? '')
  }

  async function commit(cats: Category[], message: string): Promise<Category[]> {
    const newContent = serializeCategories(cats)
    const existing = await git.readFile(TAXONOMY_PATH)
    if (newContent === (existing ?? '')) return cats
    await git.commitFile({ path: TAXONOMY_PATH, content: newContent, message, author })
    return cats
  }

  return {
    read,
    async create({ name, parent }) {
      const { cats, slug } = addCategory(await read(), { name, parent })
      const categories = await commit(cats, `taxonomy: add category ${slug}`)
      return { categories, slug }
    },
    async renameLabel(slug, name) {
      return commit(renameLabelOp(await read(), slug, name), `taxonomy: rename ${slug}`)
    },
    async reparent(slug, parent) {
      return commit(reparentOp(await read(), slug, parent), `taxonomy: reparent ${slug}`)
    },
  }
}
