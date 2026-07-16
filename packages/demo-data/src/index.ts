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

export {
  createAicPack,
  AIC_IIIF_BASE,
  AIC_ARTWORK_PAGE_BASE,
  AIC_MAX_RECORD_BYTES,
  AIC_RELAXED_BODY_NOTE,
  AIC_SKIP_REASONS
} from './aic/pack'
export type { AicPackOptions, AicSkipReason } from './aic/pack'
export {
  fetchAicDump,
  nodeResolveHost,
  AIC_DUMP_URL,
  AIC_DUMP_ARTWORKS_PATH
} from './aic/fetch-dump'
export type { FetchAicDumpOptions, FetchAicDumpResult } from './aic/fetch-dump'
export { fetchAicSample, AIC_API_ARTWORKS_URL } from './aic/fetch-sample'
export type { FetchAicSampleOptions } from './aic/fetch-sample'

export * from './engine'
