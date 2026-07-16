/** Fetch the AIC nightly data dump (verified 2026-07-16):
 *  https://github.com/art-institute-of-chicago/api-data → full tarball at
 *  https://artic-api-data.s3.amazonaws.com/artic-api-data.tar.bz2 (~115 MiB
 *  compressed, ~2.5 GB extracted; `json/artworks/` alone is 134k files / ~1 GB).
 *
 *  The download goes through core's SSRF-hardened `safeFetch` seam (https-only,
 *  redirect-capped, size-capped, time-capped) with a Node DNS resolver — the same
 *  pattern as `apps/api/src/sitehealth.ts`. safeFetch buffers the body by design;
 *  ~115 MiB in memory is acceptable for a dev-only CLI and keeps the hardened seam
 *  instead of a bespoke streaming fetch.
 *
 *  Extraction shells out to the system `tar` (bsdtar/GNU tar both read .tar.bz2):
 *  Node has no built-in bzip2 decompressor and pulling a decompression dependency
 *  for dev tooling fails the supply-chain check. Only the artworks subtree is
 *  extracted. Keyless by design — no API keys anywhere.
 */
import { spawn } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeFetch } from '@setu/core'

export const AIC_DUMP_URL =
  'https://artic-api-data.s3.amazonaws.com/artic-api-data.tar.bz2'
/** Tarball-internal path of the per-artwork records. */
export const AIC_DUMP_ARTWORKS_PATH = 'artic-api-data/json/artworks'

/** Node DNS resolver for safeFetch's `resolveHost` seam (same as apps/api). */
export const nodeResolveHost = async (hostname: string): Promise<string[]> => {
  const answers = await lookup(hostname, { all: true })
  return answers.map((a) => a.address)
}

const runSystemTar = (args: string[], cwd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn('tar', args, { cwd, stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`tar ${args.join(' ')} exited with code ${code}`))
    )
  })

export interface FetchAicDumpOptions {
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch
  /** Injectable DNS resolver (tests). Default: Node dns.lookup. */
  resolveHost?: (hostname: string) => Promise<string[]>
  /** Injectable tar runner (tests). Default: system `tar`, no shell. */
  runTar?: (args: string[], cwd: string) => Promise<void>
  /** Skip extraction, keep only the tarball. Default: extract. */
  extract?: boolean
  /** Download cap. Dump measured 119,891,546 bytes on 2026-07-16; default leaves
   *  growth headroom. */
  maxBytes?: number
  /** Whole-download deadline. Default 20 minutes. */
  timeoutMs?: number
}

export interface FetchAicDumpResult {
  tarballPath: string
  /** Extracted per-artwork records dir (pack `source`), or null with extract:false. */
  artworksDir: string | null
  /** false when an existing non-empty tarball in destDir was reused. */
  downloaded: boolean
}

export async function fetchAicDump(
  destDir: string,
  options: FetchAicDumpOptions = {}
): Promise<FetchAicDumpResult> {
  const {
    fetchImpl,
    resolveHost = nodeResolveHost,
    runTar = runSystemTar,
    extract = true,
    maxBytes = 512 * 1024 * 1024,
    timeoutMs = 20 * 60 * 1000
  } = options

  // Resolve up front: tar runs with cwd=dest, so every path handed to it (and
  // returned to callers) must be absolute — a relative destDir (the CLI default
  // ".demo-data") would otherwise make tar look for destDir/destDir/….
  const dest = path.resolve(destDir)
  await mkdir(dest, { recursive: true })
  const tarballPath = path.join(dest, 'artic-api-data.tar.bz2')

  // Reuse an existing non-empty tarball (the dump refreshes monthly; delete the
  // file to force a fresh download).
  const existing = await stat(tarballPath).catch(() => null)
  const downloaded = !(existing?.isFile() && existing.size > 0)
  if (downloaded) {
    const res = await safeFetch(AIC_DUMP_URL, undefined, {
      fetchImpl,
      resolveHost,
      maxBytes,
      timeoutMs
    })
    if (!res.ok)
      throw new Error(
        `Dump download failed: HTTP ${res.status} from ${res.finalUrl}`
      )
    await writeFile(tarballPath, res.body)
  }

  if (!extract) return { tarballPath, artworksDir: null, downloaded }

  await runTar(['-xjf', tarballPath, AIC_DUMP_ARTWORKS_PATH], dest)
  const artworksDir = path.join(dest, AIC_DUMP_ARTWORKS_PATH)
  const extracted = await stat(artworksDir).catch(() => null)
  if (!extracted?.isDirectory())
    throw new Error(
      `Extraction finished but the artworks directory is missing: ${artworksDir}`
    )
  return { tarballPath, artworksDir, downloaded }
}
