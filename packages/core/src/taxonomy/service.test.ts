import { describe, expect, it } from 'vitest'
import { createMemoryGitPort } from '@setu/git-memory'
import { createTaxonomyService, TAXONOMY_PATH } from './service'
import { parseCategories } from './parse'

const author = { name: 'Test', email: 'test@setu.dev' }

describe('TaxonomyService', () => {
  it('reads [] when the file is absent', async () => {
    const svc = createTaxonomyService({ git: createMemoryGitPort(), author })
    expect(await svc.read()).toEqual([])
  })

  it('create commits the category and returns the new list + slug', async () => {
    const git = createMemoryGitPort()
    const svc = createTaxonomyService({ git, author })
    const { categories, slug } = await svc.create({
      name: 'Tutorials',
      parent: null
    })
    expect(slug).toBe('tutorials')
    expect(categories).toEqual([
      { slug: 'tutorials', name: 'Tutorials', parent: null }
    ])
    expect(parseCategories((await git.readFile(TAXONOMY_PATH))!)).toEqual(
      categories
    )
  })

  it('create nests under an existing parent', async () => {
    const git = createMemoryGitPort()
    const svc = createTaxonomyService({ git, author })
    await svc.create({ name: 'Tutorials', parent: null })
    const { slug } = await svc.create({ name: 'React', parent: 'tutorials' })
    expect(slug).toBe('react')
    expect((await svc.read()).find((c) => c.slug === 'react')!.parent).toBe(
      'tutorials'
    )
  })

  it('renameLabel and reparent persist to git', async () => {
    const git = createMemoryGitPort()
    const svc = createTaxonomyService({ git, author })
    await svc.create({ name: 'Tutorials', parent: null })
    await svc.create({ name: 'React', parent: null })
    await svc.renameLabel('tutorials', 'Guides')
    const afterReparent = await svc.reparent('react', 'tutorials')
    expect(afterReparent.find((c) => c.slug === 'tutorials')!.name).toBe(
      'Guides'
    )
    expect(afterReparent.find((c) => c.slug === 'react')!.parent).toBe(
      'tutorials'
    )
    expect(parseCategories((await git.readFile(TAXONOMY_PATH))!)).toEqual(
      afterReparent
    )
  })

  it('reparent to same parent is a no-op (no new commit)', async () => {
    const git = createMemoryGitPort()
    const svc = createTaxonomyService({ git, author })
    await svc.create({ name: 'Tutorials', parent: null })
    const shaAfterCreate = await git.headSha()
    // reparent to current parent (null) — file content is unchanged, should not commit
    await svc.reparent('tutorials', null)
    expect(await git.headSha()).toBe(shaAfterCreate)
  })
})
