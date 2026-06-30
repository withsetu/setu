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
  write('astro-intro', 'title: Astro Intro\ntags: [astro, cms]\nfeaturedImage: /media/2026/06/a.jpg')
  write('astro-tips', 'title: Astro Tips\ntags: [astro, edge]')
  write('cooking', 'title: Cooking\ntags: [food]')
  // A French sibling sharing the 'astro' tag — must never leak into an en post's related list.
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
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('never leaks a different-locale post into the related list', () => {
  const dir = fixtureDir()
  try {
    const graph = buildRelationsGraph(dir)
    for (const refs of Object.values(graph))
      for (const r of refs) assert.ok(!r.href.includes('/fr/'), `leaked fr post: ${r.href}`)
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

test('related items carry the target post featuredImage when it has one', () => {
  const dir = fixtureDir()
  try {
    const graph = buildRelationsGraph(dir)
    // astro-tips relates to astro-intro (shared 'astro'); astro-intro has a featuredImage.
    const refs = graph['post/en/astro-tips']
    const intro = refs.find((r) => r.href === '/post/astro-intro')
    assert.equal(intro.featuredImage, '/media/2026/06/a.jpg')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('frontmatter related: false yields no related items', () => {
  const dir = fixtureDir()
  try {
    writeFileSync(
      path.join(dir, 'post', 'en', 'astro-tips.mdoc'),
      `---\ntitle: Astro Tips\ntags: [astro]\nrelated: false\n---\n\nbody\n`,
    )
    assert.deepEqual(buildRelationsGraph(dir)['post/en/astro-tips'], [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('frontmatter related: [slug] pins that post (ordered), with its featuredImage', () => {
  const dir = fixtureDir()
  try {
    writeFileSync(
      path.join(dir, 'post', 'en', 'cooking.mdoc'),
      `---\ntitle: Cooking\ntags: [food]\nrelated: [astro-intro]\n---\n\nbody\n`,
    )
    const refs = buildRelationsGraph(dir)['post/en/cooking']
    assert.equal(refs.length, 1)
    assert.equal(refs[0].href, '/post/astro-intro')
    assert.equal(refs[0].title, 'Astro Intro')
    assert.equal(refs[0].featuredImage, '/media/2026/06/a.jpg')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
