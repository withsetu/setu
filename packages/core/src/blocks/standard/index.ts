import type { StandardBlock } from './types'
import { buttonBlock } from './button'
import { heroBlock } from './hero'
import { spacerBlock } from './spacer'
import { videoBlock } from './video'
import { sectionBlock } from './section'
import { columnsBlock, columnBlock } from './columns'

/** The canonical core block library — contracts that ship with Setu, token-themed. */
export const STANDARD_BLOCKS: StandardBlock[] = [
  buttonBlock,
  heroBlock,
  spacerBlock,
  videoBlock,
  sectionBlock,
  columnsBlock,
  columnBlock
]
