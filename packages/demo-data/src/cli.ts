/** Demo-data CLI (#511 pack tools, #512 seed engine). Run from the repo:
 *
 *    pnpm --filter @setu/demo-data aic fetch  [destDir]          # full dump (~115 MiB dl, ~1 GB extracted)
 *    pnpm --filter @setu/demo-data aic sample [destFile] [count] # bounded slice via the public API
 *    pnpm --filter @setu/demo-data aic stats  <source> [limit]   # pack stats over a dump dir or .jsonl
 *    pnpm --filter @setu/demo-data seed   [--posts 1000 …]       # seed users/posts/images into the dev sandbox
 *    pnpm --filter @setu/demo-data unseed [--sandbox …]          # remove everything a seed generated
 *
 *  Defaults write under ./.demo-data/ (packs) and target the `pnpm dev`
 *  sandbox + media dirs (seed). Dev tooling only — never part of a production
 *  build; seeded passwords are dev credentials, shown once. */
import path from 'node:path'
import type { PackPost } from './contract'
import { createAicPack } from './aic/pack'
import { fetchAicDump } from './aic/fetch-dump'
import { fetchAicSample } from './aic/fetch-sample'
import {
  defaultMediaDir,
  defaultSandboxDir,
  removeSeeded,
  resolveRepoRoot,
  seedDemoData
} from './engine'
import type { SeedProgress } from './engine'

const USAGE = `Usage:
  aic fetch  [destDir]           download + extract the AIC data dump (default destDir: .demo-data)
  aic sample [destFile] [count]  fetch a bounded record sample from the public API (default: .demo-data/aic-sample.jsonl, 200)
  aic stats  <source> [limit]    print pack stats over a dump directory or .jsonl file
  seed [flags]                   seed demo users/posts/taxonomies/images into a dev sandbox
    --posts <n>                  posts to seed (default 1000)
    --admins/--maintainers/--editors/--authors <n>   users per role (default 1/1/2/5)
    --draft-fraction <0..1>      fraction seeded as drafts (default 0.1)
    --relax-text                 admit short-description records (labeled template bodies)
    --limit-images <n>           only the first n posts get featured images
    --concurrency <n>            parallel image downloads (default 4)
    --source <path>              AIC dump dir or .jsonl (default: .demo-data auto-detect)
    --sandbox <dir>              content sandbox (default: $SETU_REPO_DIR or .content-sandbox/dev)
    --media <dir>                media dir (default: $SETU_MEDIA_DIR or .setu/uploads)
  unseed [--sandbox <dir>] [--media <dir>]   remove ONLY what seeding generated`

async function printStats(source: string, limit?: number): Promise<void> {
  const pack = createAicPack({ source })
  const dataset = pack.load(limit !== undefined ? { limit } : {})
  const started = Date.now()
  // Iterate the stream — never materialize the dataset (contract.ts: on the
  // full dump that would buffer 134k posts). Keep only a 3-post preview.
  const preview: PackPost[] = []
  for await (const post of dataset.posts) {
    if (preview.length < 3) preview.push(post)
  }
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
  for (const post of preview) {
    console.log(
      `  • [${post.date.slice(0, 10)}] ${post.title} — ${post.sourceAttribution}`
    )
    if (post.image) console.log(`    image@843: ${post.image.urlForWidth(843)}`)
  }
}

interface SeedFlags {
  posts: number
  admins: number
  maintainers: number
  editors: number
  authors: number
  draftFraction: number
  relaxText: boolean
  limitImages?: number
  concurrency: number
  source?: string
  sandbox: string
  media: string
}

/** Exported for tests only — not part of the package surface. */
export function intFlag(
  raw: string | undefined,
  name: string,
  fallback: number
): number {
  if (raw === undefined) return fallback
  // Strict: parseInt would silently truncate "1.5" → 1 and "12abc" → 12 —
  // a mistyped flag must fail loudly, not seed the wrong amount.
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${name}: ${raw}`)
  const n = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error(`Invalid ${name}: ${raw}`)
  return n
}

const SEED_FLAG_NAMES = [
  'posts',
  'admins',
  'maintainers',
  'editors',
  'authors',
  'draft-fraction',
  'relax-text',
  'limit-images',
  'concurrency',
  'source',
  'sandbox',
  'media'
] as const

/** Exported for tests only — not part of the package surface. */
export function parseSeedFlags(
  args: string[],
  allowed: readonly string[] = SEED_FLAG_NAMES
): SeedFlags {
  const raw = new Map<string, string | boolean>()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('--'))
      throw new Error(`Unexpected argument: ${arg}\n${USAGE}`)
    const name = arg.slice(2)
    if (name === 'relax-text') {
      raw.set(name, true)
      continue
    }
    const value = args[++i]
    if (value === undefined) throw new Error(`Flag --${name} needs a value`)
    raw.set(name, value)
  }
  const known = new Set(allowed)
  for (const name of raw.keys())
    if (!known.has(name))
      throw new Error(`Flag --${name} is not valid for this command\n${USAGE}`)

  const str = (name: string): string | undefined => {
    const v = raw.get(name)
    return typeof v === 'string' ? v : undefined
  }
  const root = resolveRepoRoot()
  const draftFraction = Number(str('draft-fraction') ?? '0.1')
  if (!Number.isFinite(draftFraction) || draftFraction < 0 || draftFraction > 1)
    throw new Error(`Invalid --draft-fraction: ${str('draft-fraction') ?? ''}`)
  const limitImagesRaw = str('limit-images')
  return {
    posts: intFlag(str('posts'), '--posts', 1000),
    admins: intFlag(str('admins'), '--admins', 1),
    maintainers: intFlag(str('maintainers'), '--maintainers', 1),
    editors: intFlag(str('editors'), '--editors', 2),
    authors: intFlag(str('authors'), '--authors', 5),
    draftFraction,
    relaxText: raw.get('relax-text') === true,
    ...(limitImagesRaw !== undefined
      ? { limitImages: intFlag(limitImagesRaw, '--limit-images', 0) }
      : {}),
    concurrency: Math.max(1, intFlag(str('concurrency'), '--concurrency', 4)),
    ...(str('source') !== undefined ? { source: str('source')! } : {}),
    sandbox: path.resolve(str('sandbox') ?? defaultSandboxDir(root)),
    media: path.resolve(str('media') ?? defaultMediaDir(root))
  }
}

/** Locate an already-fetched AIC source: prefer the extracted dump, fall back
 *  to a sampled .jsonl. Never downloads implicitly — `aic fetch` is explicit. */
async function detectAicSource(): Promise<string> {
  const { stat } = await import('node:fs/promises')
  const root = resolveRepoRoot()
  const candidates = [
    path.join(root, '.demo-data', 'artic-api-data', 'json', 'artworks'),
    path.join(
      root,
      'packages',
      'demo-data',
      '.demo-data',
      'artic-api-data',
      'json',
      'artworks'
    ),
    path.join(root, '.demo-data', 'aic-sample.jsonl'),
    path.join(root, 'packages', 'demo-data', '.demo-data', 'aic-sample.jsonl')
  ]
  for (const candidate of candidates) {
    if (
      await stat(candidate).then(
        () => true,
        () => false
      )
    )
      return candidate
  }
  throw new Error(
    'No AIC source found — run `pnpm --filter @setu/demo-data aic fetch` ' +
      '(full dump) or `aic sample` (bounded slice) first, or pass --source.'
  )
}

/** stdout progress: users and categories line-by-line; images/posts
 *  throttled. `verb` distinguishes seeding from removal wording. */
function printProgress(
  progress: SeedProgress,
  verb: 'seed' | 'remove' = 'seed'
): void {
  const removing = verb === 'remove'
  switch (progress.phase) {
    case 'warning':
      console.warn(`⚠  ${progress.message}`)
      return
    case 'users':
      if (progress.done === progress.total)
        console.log(
          `users: ${progress.done}/${progress.total} ${removing ? 'removed' : 'ready'}`
        )
      return
    case 'plan':
      if (progress.done % 500 === 0 || progress.done === progress.total)
        console.log(`plan: ${progress.done}/${progress.total} posts`)
      return
    case 'categories':
      console.log(
        progress.added >= 0
          ? `categories: ${progress.added} added`
          : `categories: ${-progress.added} removed`
      )
      return
    case 'images':
      if (
        progress.done % 25 === 0 ||
        progress.done + progress.failed === progress.total
      )
        console.log(
          `${removing ? 'media removed' : 'images'}: ${progress.done}/${progress.total}` +
            (progress.failed > 0 ? ` (${progress.failed} failed)` : '')
        )
      return
    case 'posts':
      console.log(
        `posts: ${progress.done}/${progress.total} ${removing ? 'removed' : 'committed'}`
      )
  }
}

async function runSeed(args: string[]): Promise<void> {
  const flags = parseSeedFlags(args)
  const source = flags.source ?? (await detectAicSource())
  const pack = createAicPack({
    source,
    ...(flags.relaxText ? { textTier: 'relaxed' as const } : {})
  })
  console.log(`pack: ${pack.meta.id} over ${source}`)
  console.log(`sandbox: ${flags.sandbox}`)
  console.log(`media: ${flags.media}`)

  const controller = new AbortController()
  const onSigint = (): void => {
    console.log('\naborting — progress is checkpointed; re-run to resume')
    controller.abort()
  }
  process.once('SIGINT', onSigint)
  try {
    const summary = await seedDemoData({
      sandboxDir: flags.sandbox,
      mediaDir: flags.media,
      pack,
      posts: flags.posts,
      users: {
        admin: flags.admins,
        maintainer: flags.maintainers,
        editor: flags.editors,
        author: flags.authors
      },
      draftFraction: flags.draftFraction,
      relaxText: flags.relaxText,
      concurrency: flags.concurrency,
      ...(flags.limitImages !== undefined
        ? { limitImages: flags.limitImages }
        : {}),
      onProgress: (p) => printProgress(p, 'seed'),
      signal: controller.signal
    })
    console.log('')
    console.log(
      `seeded ${summary.posts} posts, ${summary.images} images` +
        (summary.imagesReused > 0 ? ` (+${summary.imagesReused} reused)` : '') +
        (summary.imageFailures > 0
          ? ` (${summary.imageFailures} image downloads failed — re-run to retry)`
          : '') +
        `, ${summary.commits} commits in ${(summary.durationMs / 1000).toFixed(1)}s`
    )
    const skipped = Object.entries(summary.skipped)
    if (skipped.length > 0)
      console.log(
        `pack skipped: ${skipped.map(([k, v]) => `${k}=${v}`).join(' ')}`
      )
    console.log('')
    console.log(
      'demo users (DEV-ONLY credentials — shown once, never stored in plain text):'
    )
    for (const user of summary.users) {
      console.log(
        `  ${user.email}  role=${user.role}  ` +
          (user.password === null
            ? 'password unchanged (already existed)'
            : `password=${user.password}`)
      )
    }
    console.log('')
    console.log(
      'Note: content is committed to the sandbox repo — a static site build ' +
        'still needs its own rebuild to show it (saved ≠ live).'
    )
  } finally {
    process.removeListener('SIGINT', onSigint)
  }
}

async function runUnseed(args: string[]): Promise<void> {
  // Unseed consumes the manifest — seed-shaping flags would be silently
  // meaningless here, so only the location flags are accepted.
  const flags = parseSeedFlags(args, ['sandbox', 'media'])
  const summary = await removeSeeded({
    sandboxDir: flags.sandbox,
    mediaDir: flags.media,
    onProgress: (p) => printProgress(p, 'remove')
  })
  console.log(
    `removed ${summary.posts} posts, ${summary.media} media items, ` +
      `${summary.users} users, ${summary.categories} categories ` +
      `in ${(summary.durationMs / 1000).toFixed(1)}s`
  )
  if (summary.userFailures > 0)
    console.log(
      `${summary.userFailures} user(s) could not be deleted (e.g. the last-admin guard)`
    )
  if (summary.usersSkipped > 0)
    console.log(
      `${summary.usersSkipped} manifest user entr${summary.usersSkipped === 1 ? 'y' : 'ies'} skipped (non-demo email — never deleted by unseed)`
    )
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  switch (command) {
    case 'seed':
      return runSeed(args)
    case 'unseed':
      return runUnseed(args)
    case 'fetch': {
      const destDir = args[0] ?? '.demo-data'
      console.log(`fetching AIC dump into ${destDir} (~115 MiB download)…`)
      const { tarballPath, artworksDir, downloaded } =
        await fetchAicDump(destDir)
      console.log(
        `tarball: ${tarballPath}${downloaded ? '' : ' (reused existing download)'}`
      )
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
