import type { ZodTypeAny } from 'zod'
import type { BlockEditorMeta } from '../config/types'

/** The contract an author exports from `blocks/<tag>/block.ts`. `tag` and the render
 *  `component` are injected by the discovery scan from the folder, not authored here. */
export interface BlockContract {
  /** Zod schema for the block's Markdoc attributes. */
  props: ZodTypeAny
  editor?: BlockEditorMeta
  /** Content types the block is meant for. Reserved — carried, not enforced (Slice A). */
  scope?: string[]
}

/** Identity helper: exists purely for type inference + a stable import (mirrors defineConfig). */
export const defineBlock = (contract: BlockContract): BlockContract => contract
