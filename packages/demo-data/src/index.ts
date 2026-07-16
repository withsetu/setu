/** @setu/demo-data — content packs for the demo-data add-on (#511, epic #509).
 *
 *  Node-only dev tooling by design: never import this package from anything
 *  edge-reachable (see README.md). The vitest contract suite lives on the
 *  `@setu/demo-data/contract-suite` subpath so runtime consumers never pull
 *  vitest into their module graph.
 */
export type {
  ContentPack,
  PackDataset,
  PackImageRef,
  PackLoadOptions,
  PackMeta,
  PackPost,
  PackStats
} from './contract'
export { collectPosts } from './contract'
