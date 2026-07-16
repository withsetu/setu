import { fileURLToPath } from 'node:url'
import { runContentPackContract } from '../src/contract-suite'
import { createAicPack } from '../src/index'

const fixtures = fileURLToPath(new URL('./fixtures/artworks', import.meta.url))

// The AIC pack must pass the generic ContentPack contract over the synthetic
// fixture dump (3 loadable posts among 9 records — see fixtures/README.md).
runContentPackContract(() => createAicPack({ source: fixtures }), {
  minPosts: 4,
  widths: [200, 843, 1686]
})
