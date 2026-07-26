import { configSchema } from './schema'
import { DEFAULT_COLLECTIONS, resolveCollection } from './collections'
import type {
  CollectionDefinition,
  ResolvedBlock,
  ResolvedCollection,
  ResolvedConfig
} from './types'

/** Validate an authored config, index its blocks, and derive the known-tag set.
 *  Throws a clear Error on invalid input (config errors must fail loudly). */
export function resolveConfig(raw: unknown): ResolvedConfig {
  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  [${i.path.join('.')}] ${i.message}`)
      .join('\n')
    throw new Error(`Invalid setu.config:\n${issues}`)
  }

  const blocks = parsed.data.blocks as ResolvedBlock[]
  const blocksByTag = new Map<string, ResolvedBlock>()
  for (const block of blocks) {
    if (blocksByTag.has(block.tag)) {
      throw new Error(`Duplicate block tag "${block.tag}" in setu.config.ts`)
    }
    blocksByTag.set(block.tag, block)
  }

  const authored = parsed.data.collections as CollectionDefinition[]
  const seen = new Set<string>()
  for (const c of authored) {
    if (seen.has(c.name)) {
      throw new Error(`Duplicate collection name "${c.name}" in setu.config.ts`)
    }
    seen.add(c.name)
  }

  // Defaults first, then authored — `set` on an existing key replaces the default in
  // place, so overriding `post` keeps its position rather than moving it to the end.
  const collectionsByName = new Map<string, ResolvedCollection>()
  for (const def of [...DEFAULT_COLLECTIONS, ...authored]) {
    collectionsByName.set(def.name, resolveCollection(def))
  }

  return {
    collections: [...collectionsByName.values()],
    collectionsByName,
    blocks,
    blocksByTag,
    knownBlockTags: new Set(blocksByTag.keys()),
    theme: parsed.data.theme,
    themeOptions: parsed.data.themeOptions,
    permalinks: parsed.data.permalinks
  }
}
