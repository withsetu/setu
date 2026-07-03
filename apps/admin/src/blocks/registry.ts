// Auto-discover folder blocks at admin build time. Vite globs the repo-root blocks/
// (each block.ts default-exports a BlockContract) into the bundle; we pair it with the
// folder name to build the registry. Path is relative to THIS file: blocks -> src ->
// admin -> apps -> repo root. blocks/ is outside the admin root, so the dev server must
// allow it (see vite.config.ts server.fs.allow).
import { buildRegistry, mergeBlockSources, STANDARD_BLOCKS } from '@setu/core'
import type { BlockContract, BlockRegistry } from '@setu/core'

// Explicit type argument instead of an `as Record<…>` cast: with a cast, the assertion
// contextually drives the generic's inference, which makes no-unnecessary-type-assertion
// (rightly) see a self-cast and --fix strip it — breaking the typecheck. The type arg
// states the same intent without the false-positive trap.
const mods = import.meta.glob<BlockContract>('../../../../blocks/*/block.ts', {
  eager: true,
  import: 'default'
})

const folderOf = (p: string): string => p.split('/').slice(-2, -1)[0]!

const local = Object.entries(mods).map(([path, contract]) => {
  const tag = folderOf(path)
  return { tag, component: `blocks/${tag}/${tag}.astro`, contract }
})

// Union core standard blocks with site-local folder blocks; local wins on a tag collision.
export const registry: BlockRegistry = buildRegistry(
  mergeBlockSources({ standard: STANDARD_BLOCKS, local })
)

// `image` has a dedicated editor node (ImageBlock) but is NOT a folder block — its render
// needs apps/site's build-time manifest read (#5a). Register it as a known editor tag so the
// round-trip maps {% image %} to the imageBlock node instead of a passthrough.
registry.knownBlockTags.add('image')
