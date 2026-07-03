import type { ResolvedBlock } from '../config/types'
import type { BlockContract } from './define-block'

/** A discovered block folder: its tag (folder name), its render component path, and the
 *  authored contract. */
export interface BlockEntry {
  tag: string
  component: string
  contract: BlockContract
}

/** The block registry — the single source the editor, round-trip, and codegen consume,
 *  replacing the hand-maintained `setu.config.blocks` array. */
export interface BlockRegistry {
  blocks: ResolvedBlock[]
  blocksByTag: Map<string, ResolvedBlock>
  knownBlockTags: Set<string>
}

/** Assemble a registry from discovered folder entries. Throws on a duplicate tag
 *  (mirrors resolveConfig's existing guard). */
export function buildRegistry(entries: BlockEntry[]): BlockRegistry {
  const blocksByTag = new Map<string, ResolvedBlock>()
  const blocks: ResolvedBlock[] = []
  for (const { tag, component, contract } of entries) {
    if (blocksByTag.has(tag))
      throw new Error(`Duplicate block tag "${tag}" across block folders`)
    const block: ResolvedBlock = {
      tag,
      props: contract.props,
      component,
      ...(contract.editor ? { editor: contract.editor } : {}),
      ...(contract.scope ? { scope: contract.scope } : {})
    }
    blocksByTag.set(tag, block)
    blocks.push(block)
  }
  return { blocks, blocksByTag, knownBlockTags: new Set(blocksByTag.keys()) }
}
