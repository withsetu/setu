import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildRelationsGraph } from './gen-relations.mjs'

function fixtureDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'setu-relations-'))
  const post = path.join(dir, 'post', 'en')
  mkdirSync(post, { recursive: true })
  const write = (slug, fm) =>
    writeFileSync(path.join(post, `${slug}.mdoc`), `---\n${fm}\n---\n\nbody\n`)
  write('astro-intro', 'title: Astro Intro\ntags: [astro, cms]')
  write('astro-tips', 'title: Astro Tips\ntags: [astro, edge]')
  write('cooking', 'title: Cooking\ntags: [food]')
  // other-locale sibling must never leak into an en post's relations
  const fr = path.join(dir, 'post', 'fr')
  mkdirSync(fr, { recursive: true })
  writeFileSync(path.join(fr, 'bonjour.mdoc'), `---\ntitle: Bonjour\ntags: [astro]\n---\n\nbody\n`)
  return dir
}

test('builds an entry-id-keyed graph with resolved title + href', () => {
  const dir = fixtureDir()
  try {
    const graph = buildRelationsGraph(dir)
    // astro-intro relates to astro-tips (shared 'astro' tag), same locale only.
    assert.deepEqual(graph['post/en/astro-intro'][0], {
      title: 'Astro Tips',
      href: '/post/astro-tips',
    })
    // never links the French sibling despite the shared tag
    assert.ok(!graph['post/en/astro-intro'].some((r) => r.href.includes('/fr/')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('default-locale href omits the locale segment', () => {
  const dir = fixtureDir()
  try {
    const graph = buildRelationsGraph(dir)
    for (const refs of Object.values(graph))
      for (const r of refs) assert.ok(r.href.startsWith('/post/') && !r.href.includes('/en/'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
