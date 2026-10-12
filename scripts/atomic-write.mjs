// Atomic file replacement for the site generators (#1207).
//
// gen-blocks / gen-relations / gen-redirects rewrite shared generated files, and more than one
// of them can run at once: turbo starts @setu/site#test (whose suites run `pnpm build` ->
// `prebuild`) and @setu/site#lint in parallel, both re-running the generators, and `pnpm dev`'s
// `predev` can overlap a turbo task too. A plain writeFileSync truncates the target first, so a
// concurrent reader (astro sync, tsc, a build) can observe an empty or half-written file.
//
// Writing to a temp file in the SAME directory and renaming it over the target makes the swap
// atomic on POSIX filesystems (rename(2) within one filesystem): a reader sees either the old
// file or the new one, never a partial one. The temp name is unique per process and call, so two
// writers never share a temp file; the last rename wins with a complete file either way.
// Enforced by scripts/atomic-write.test.mjs.
import { randomBytes } from 'node:crypto'
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Write `data` to `file` via a same-directory temp file + rename. The parent directory must
 *  already exist (callers create it, as they did before). */
export function writeFileAtomic(file, data) {
  const dir = path.dirname(file)
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  )
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, file)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}
