// Auto-discover folder blocks at admin build time. Vite globs the repo-root blocks/
// (each block.ts default-exports a BlockContract) into the bundle; we pair it with the
// folder name to build the registry. Path is relative to THIS file: blocks -> src ->
// admin -> apps -> repo root. blocks/ is outside the admin root, so the dev server must
// allow it (see vite.config.ts server.fs.allow).
import { buildRegistry } from '@setu/core'
import type { BlockContract, BlockRegistry } from '@setu/core'

const mods = import.meta.glob('../../../../blocks/*/block.ts', { eager: true, import: 'default' }) as Record<
  string,
  BlockContract
>

const folderOf = (p: string): string => p.split('/').slice(-2, -1)[0]!

export const registry: BlockRegistry = buildRegistry(
  Object.entries(mods).map(([path, contract]) => {
    const tag = folderOf(path)
    return { tag, component: `blocks/${tag}/${tag}.astro`, contract }
  }),
)
