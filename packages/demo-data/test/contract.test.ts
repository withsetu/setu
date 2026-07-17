import { fileURLToPath } from 'node:url'
import { runContentPackContract } from '../src/contract-suite'
import { createAicPack } from '../src/index'

const fixtures = fileURLToPath(new URL('./fixtures/artworks', import.meta.url))

// The AIC pack must pass the generic ContentPack contract over the synthetic
// fixture dump (4 loadable posts among 11 records — see fixtures/README.md).
runContentPackContract(() => createAicPack({ source: fixtures }), {
  minPosts: 4,
  widths: [200, 843, 1686]
})

// The relaxed text tier (#512 relaxText) is a distinct pack configuration and
// must independently satisfy the same behavioural contract.
runContentPackContract(
  () => createAicPack({ source: fixtures, textTier: 'relaxed' }),
  { minPosts: 5, widths: [200, 843, 1686] }
)
