import type { BlockEntry } from './registry'
import type { StandardBlock } from './standard/types'

/** Union core standard blocks with site-local folder blocks into BlockEntry[] for
 *  buildRegistry. Site-local wins on a tag collision, so any site can override a standard
 *  block by dropping a blocks/<tag>/ folder. A standard block's renderer specifier becomes
 *  its `component`. */
export function mergeBlockSources(input: {
  standard: StandardBlock[]
  local: BlockEntry[]
}): BlockEntry[] {
  const { standard, local } = input
  const localTags = new Set(local.map((e) => e.tag))
  const fromStandard: BlockEntry[] = standard
    .filter((s) => !localTags.has(s.tag))
    .map((s) => ({ tag: s.tag, component: s.renderer, contract: s.contract }))
  return [...fromStandard, ...local]
}
