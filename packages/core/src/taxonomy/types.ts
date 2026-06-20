/** A single category. `parent` is the slug of its parent, or null for a root. */
export interface Category {
  slug: string
  name: string
  parent: string | null
}

/** A category assembled into the hierarchy, with its children and 0-based depth. */
export interface CategoryNode extends Category {
  children: CategoryNode[]
  depth: number
}
