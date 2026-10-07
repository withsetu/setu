// Out-of-package reads: every place a workspace package's code reaches OUT of its own directory
// via a relative path literal (a test that walks repo-root blocks/, a vite.config.ts importing a
// repo script, a test reading a sibling app's file). Two consumers share this one scan, so they
// cannot drift apart:
//
//   - scripts/turbo-inputs.test.mjs (#1197) asserts each such read is in the reading task's
//     turbo `inputs` — that is what keeps the remote cache from replaying a stale pass.
//   - .github/workflows/ci.yml's "Determine affected scope" step (#1206) runs this file as a CLI.
//     `inputs` only affect HASHING; PR task SELECTION is turbo's `--filter "...[<sha>]"`, which
//     maps a changed file to the package that OWNS it and walks the package dependency graph.
//     So a change to apps/site/src/preview/preview.astro selects @setu/site and its dependents,
//     never @setu/admin#test, which reads it. The CI step forces a full run when the diff touches
//     a path some OTHER package reads and the filter would not reach that reader.
//
// CLI: `git diff --name-only <base> HEAD | node scripts/cross-package-reads.mjs` prints one line
// per changed file that such a reader depends on (nothing when none). `--list` prints every
// guarded path. Behaviour is unit-tested in scripts/cross-package-reads.test.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CODE = /\.(m?[jt]sx?|astro)$/

/** Which of a package's tasks load `file` (package-relative). A test file is loaded by #test.
 *  Anything else — src/, integrations/, the vite/vitest/astro config — is loaded by #test and
 *  #build (configs and source are what those run) and is in #lint's program (`eslint .`). */
export function tasksLoading(file, scripts) {
  const has = (t) => Boolean(scripts[t])
  const isTest =
    /^(test|test-browser)\//.test(file) || /\.test\.[jt]sx?$/.test(file)
  const tasks = isTest ? ['test'] : ['test', 'build', 'lint']
  return tasks.filter(has)
}

/** Relative path literals in `src` that leave `pkgDir`. Resolved against the file's directory,
 *  kept only if `exists(repoRelativePath)` (a string that merely LOOKS like a path — e.g. an
 *  expected-output fixture in generate-markdoc.test.ts — resolves to nothing and is ignored).
 *  A literal that resolves to the repo root itself (`const repoRoot = …'../../..'…`) names no
 *  input on its own; the root-relative segments joined onto that binding later in the file —
 *  `join(repoRoot, 'content')`, `${repoRoot}/blocks` — are what get read, so those are followed.
 *  A root literal with no such binding (vite's `server.fs.allow: ['../..']`) is a permission,
 *  not a read, and is dropped. */
export function externalRefs(pkgDir, fileRel, src, exists) {
  const out = []
  const fileDir = path.posix.dirname(path.posix.join(pkgDir, fileRel))
  const keep = (resolved) => {
    if (resolved === pkgDir || resolved.startsWith(pkgDir + '/')) return
    if (resolved.startsWith('..') || resolved.includes('node_modules')) return
    const star = resolved.indexOf('*')
    const probe = star === -1 ? resolved : resolved.slice(0, star)
    if (!exists(probe)) return
    out.push(resolved.replace(/\/$/, ''))
  }
  for (const m of src.matchAll(
    /['"`]((?:\.\.\/)+[^'"`\s$]*|(?:\.\.\/)+\.\.)['"`]/g
  )) {
    const resolved = path.posix
      .normalize(path.posix.join(fileDir, m[1]))
      .replace(/(.)\/$/, '$1')
    if (resolved !== '.' && resolved !== './') {
      keep(resolved)
      continue
    }
    const lineStart = src.lastIndexOf('\n', m.index) + 1
    const binding = /(?:const|let)\s+(\w+)\s*=/.exec(
      src.slice(lineStart, m.index)
    )?.[1]
    if (!binding) continue
    const uses = [
      ...src.matchAll(
        new RegExp(`(?:join|resolve)\\(\\s*${binding},\\s*'([^']+)'`, 'g')
      ),
      ...src.matchAll(new RegExp(`\\$\\{${binding}\\}/([\\w./-]+)`, 'g'))
    ]
    for (const u of uses) keep(path.posix.normalize(u[1]))
  }
  return out
}

/** Is repo-relative `file` inside `target`? `target` is a file, a directory, or a glob string
 *  like `blocks/*\/block.ts`, in which case its static prefix is the directory that counts. */
export function pathWithin(file, target) {
  const star = target.indexOf('*')
  const t = star === -1 ? target : target.slice(0, star).replace(/\/$/, '')
  return file === t || file.startsWith(t + '/')
}

/** The workspace package dir a repo-relative path sits in, if any. */
export function owningDir(packageDirs, target) {
  return packageDirs.find((d) => pathWithin(target, d))
}

/** Every out-of-package read in the repo at `repoRoot`, one row per (file, target, task). */
export function scanReads(repoRoot) {
  const tracked = execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
    .split('\n')
    .filter(Boolean)
  const packageDirs = [
    ...new Set(
      tracked
        .filter((f) => /^(apps|packages)\/[^/]+\/package\.json$/.test(f))
        .map((f) => path.posix.dirname(f))
    )
  ].sort()
  const packages = new Map(
    packageDirs.map((d) => [
      d,
      JSON.parse(readFileSync(path.join(repoRoot, d, 'package.json'), 'utf8'))
    ])
  )
  const exists = (rel) => existsSync(path.join(repoRoot, rel))
  const findings = []
  for (const pkgDir of packageDirs) {
    const pkg = packages.get(pkgDir)
    const scripts = pkg.scripts ?? {}
    for (const f of tracked) {
      if (!f.startsWith(pkgDir + '/') || !CODE.test(f)) continue
      const fileRel = f.slice(pkgDir.length + 1)
      const src = readFileSync(path.join(repoRoot, f), 'utf8')
      for (const target of externalRefs(pkgDir, fileRel, src, exists)) {
        for (const task of tasksLoading(fileRel, scripts)) {
          findings.push({
            pkgDir,
            pkg,
            pkgName: pkg.name,
            file: f,
            target,
            task
          })
        }
      }
    }
  }
  return { findings, packageDirs, packages }
}

/** Names of every workspace package `pkgName` depends on, directly or transitively, through
 *  `dependencies` + `devDependencies` — the edges turbo's `...[<sha>]` filter walks backwards to
 *  find dependents. */
function workspaceDepsClosure(pkgName, byName) {
  const seen = new Set()
  const stack = [pkgName]
  while (stack.length) {
    const p = byName.get(stack.pop())
    if (!p) continue
    for (const dep of Object.keys({
      ...(p.dependencies ?? {}),
      ...(p.devDependencies ?? {})
    })) {
      if (byName.has(dep) && !seen.has(dep)) {
        seen.add(dep)
        stack.push(dep)
      }
    }
  }
  return seen
}

/** The reads the package-graph filter cannot see: the target sits in ANOTHER workspace package,
 *  and the reader is not a (transitive) dependent of that package. Targets outside every package
 *  (blocks/, scripts/, content/) are left out on purpose — ci.yml's root-impact guard already
 *  forces a full run for any changed file outside packages/ and apps/. */
export function unselectedReads({ findings, packageDirs, packages }) {
  const byName = new Map([...packages.values()].map((p) => [p.name, p]))
  const out = new Map()
  for (const x of findings) {
    const owner = owningDir(packageDirs, x.target)
    if (!owner || owner === x.pkgDir) continue
    const ownerName = packages.get(owner).name
    if (workspaceDepsClosure(x.pkgName, byName).has(ownerName)) continue
    const key = `${x.target}\0${x.file}`
    if (!out.has(key))
      out.set(key, { target: x.target, file: x.file, reader: x.pkgName })
  }
  return [...out.values()].sort(
    (a, b) => a.target.localeCompare(b.target) || a.file.localeCompare(b.file)
  )
}

/** Changed files that some unselected reader depends on, as `<file> (read by <reader file>)`. */
export function guardedChanges(changed, reads) {
  const hits = []
  for (const file of changed) {
    for (const r of reads) {
      if (pathWithin(file, r.target)) hits.push(`${file} (read by ${r.file})`)
    }
  }
  return hits
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  )
  const reads = unselectedReads(scanReads(repoRoot))
  if (process.argv.includes('--list')) {
    for (const r of reads) console.log(`${r.target} (read by ${r.file})`)
  } else {
    const changed = readFileSync(0, 'utf8').split('\n').filter(Boolean)
    for (const line of guardedChanges(changed, reads)) console.log(line)
  }
}
