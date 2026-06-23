import type { BlockContract } from '../define-block'

/** A block whose contract ships in @setu/core, rendered by a token-themed component in
 *  @setu/blocks. `renderer` is a bare package specifier the site codegen emits as-is. */
export interface StandardBlock {
  tag: string
  contract: BlockContract
  renderer: string
}
