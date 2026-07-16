/** Tiny CLI for smoking the AIC pack (#511). Run from the repo:
 *
 *    pnpm --filter @setu/demo-data aic fetch  [destDir]          # full dump (~115 MiB dl, ~1 GB extracted)
 *    pnpm --filter @setu/demo-data aic sample [destFile] [count] # bounded slice via the public API
 *    pnpm --filter @setu/demo-data aic stats  <source> [limit]   # pack stats over a dump dir or .jsonl
 *
 *  Defaults write under ./.demo-data/ (gitignored). Dev tooling only — never part
 *  of a production build.
 */
import { collectPosts } from './contract'
import { createAicPack } from './aic/pack'
import { fetchAicDump } from './aic/fetch-dump'
import { fetchAicSample } from './aic/fetch-sample'

const USAGE = `Usage:
  aic fetch  [destDir]           download + extract the AIC data dump (default destDir: .demo-data)
  aic sample [destFile] [count]  fetch a bounded record sample from the public API (default: .demo-data/aic-sample.jsonl, 200)
  aic stats  <source> [limit]    print pack stats over a dump directory or .jsonl file`

async function printStats(source: string, limit?: number): Promise<void> {
  const pack = createAicPack({ source })
  const dataset = pack.load(limit !== undefined ? { limit } : {})
  const started = Date.now()
  const posts = await collectPosts(dataset)
  const stats = dataset.stats()
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  console.log(`pack: ${pack.meta.id} — ${pack.meta.name}`)
  console.log(`source: ${pack.meta.sourceUrl}`)
  console.log(`license: ${pack.meta.license}`)
  console.log(`input: ${source}`)
  console.log(
    `scanned ${stats.scanned} records in ${seconds}s → ${stats.loaded} posts`
  )
  const skipped = Object.entries(stats.skipped)
  console.log(
    `skipped: ${skipped.length ? skipped.map(([k, v]) => `${k}=${v}`).join(' ') : 'none'}`
  )
  for (const post of posts.slice(0, 3)) {
    console.log(
      `  • [${post.date.slice(0, 10)}] ${post.title} — ${post.sourceAttribution}`
    )
    if (post.image) console.log(`    image@843: ${post.image.urlForWidth(843)}`)
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  switch (command) {
    case 'fetch': {
      const destDir = args[0] ?? '.demo-data'
      console.log(`downloading AIC dump to ${destDir} (~115 MiB)…`)
      const { tarballPath, artworksDir } = await fetchAicDump(destDir)
      console.log(`tarball: ${tarballPath}`)
      console.log(`artworks: ${artworksDir ?? '(not extracted)'}`)
      if (artworksDir) await printStats(artworksDir)
      return
    }
    case 'sample': {
      const destFile = args[0] ?? '.demo-data/aic-sample.jsonl'
      const count = args[1] !== undefined ? Number.parseInt(args[1], 10) : 200
      if (!Number.isFinite(count) || count <= 0)
        throw new Error(`Invalid count: ${args[1] ?? ''}`)
      console.log(`sampling ${count} records from the public AIC API…`)
      const { written } = await fetchAicSample(destFile, { count })
      console.log(`wrote ${written} records to ${destFile}`)
      await printStats(destFile)
      return
    }
    case 'stats': {
      const source = args[0]
      if (!source) throw new Error(`stats needs a source path.\n${USAGE}`)
      const limit =
        args[1] !== undefined ? Number.parseInt(args[1], 10) : undefined
      if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0))
        throw new Error(`Invalid limit: ${args[1] ?? ''}`)
      await printStats(source, limit)
      return
    }
    default:
      console.log(USAGE)
      process.exitCode = command === undefined || command === 'help' ? 0 : 1
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
