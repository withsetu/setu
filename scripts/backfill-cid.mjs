// scripts/backfill-cid.mjs
// One-time (idempotent) migration: stamp a stable `cid` (UUID) into the frontmatter of every
// content `.mdoc` that lacks one (#389). New entries get a cid at creation; this covers content
// that predates the field. Run once and commit; re-running is a no-op. Keys the redirect map
// (#252) so a slug rename is a trackable path change, not a delete+add.
import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createJiti } from 'jiti'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_CONTENT_DIR =
  process.env.SETU_CONTENT_DIR ?? path.join(ROOT, 'content')

const coreReq = createRequire(
  path.join(ROOT, 'packages', 'core', 'package.json')
)
const jiti = createJiti(import.meta.url, {
  alias: {
    '@setu/core': coreReq.resolve('@setu/core'),
    '@setu/core/node': coreReq.resolve('@setu/core/node'),
    zod: coreReq.resolve('zod')
  }
})
const { parseMdoc, serializeMdoc, newCid, isCid } =
  await jiti.import('@setu/core')

/** Recursively collect every .mdoc file under dir (absolute paths). */
function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (name.endsWith('.mdoc')) out.push(full)
  }
  return out
}

/** Stamp a cid into every cid-less .mdoc under contentDir. Returns the count stamped. Idempotent:
 *  a file that already has a valid cid is untouched (byte-for-byte), so a re-run stamps nothing. */
export function backfillCids(contentDir, mint = newCid) {
  let stamped = 0
  for (const file of walk(contentDir)) {
    const raw = readFileSync(file, 'utf8')
    const { frontmatter, body } = parseMdoc(raw)
    if (isCid(frontmatter.cid)) continue
    // cid first for readability (js-yaml preserves insertion order).
    const next = serializeMdoc({
      frontmatter: { cid: mint(), ...frontmatter },
      body
    })
    writeFileSync(file, next)
    stamped++
  }
  return stamped
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const n = backfillCids(DEFAULT_CONTENT_DIR)
  console.log(
    `backfill-cid: stamped ${n} entr${n === 1 ? 'y' : 'ies'} without a cid`
  )
}
