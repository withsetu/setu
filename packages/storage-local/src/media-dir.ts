import { join } from 'node:path'

/** The ONE rule for where local media lives (#1161): `SETU_MEDIA_DIR` when set (non-blank), else
 *  `<repoDir>/.setu/uploads` — per content repo, so two sandboxes never share an uploads dir.
 *
 *  Every consumer resolves through this: the api's storage (apps/api/src/server.ts), the Rebuild
 *  child's env (apps/api/src/deploy-wiring.ts — the site reads manifests from it), and the
 *  demo-data CLI default (packages/demo-data/src/engine/resolve-dirs.ts). `pnpm dev`'s lane env
 *  (scripts/dev-lanes.mjs) is plain JS and cannot import this, so it restates the rule; the two
 *  are held equal by apps/api/test/media-dir-parity.test.ts. Rule pinned by
 *  packages/storage-local/test/media-dir.test.ts. */
export function resolveMediaDir(
  env: Readonly<Record<string, string | undefined>>,
  repoDir: string
): string {
  const explicit = env['SETU_MEDIA_DIR']
  if (explicit !== undefined && explicit.trim() !== '') return explicit
  return join(repoDir, '.setu', 'uploads')
}
