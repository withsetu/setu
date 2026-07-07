import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import type { TiptapDoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TagAutocomplete } from '../src/ui/TagAutocomplete'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

function setup(onSubmit = vi.fn(), exclude: string[] = []) {
  const data = createMemoryDataPort([
    {
      collection: 'post',
      locale: 'en',
      slug: 's',
      content: doc('x'),
      metadata: { title: 'S', tags: ['react', 'redux'] }
    }
  ])
  const services = servicesFor(data, createMemoryGitPort())
  function Wrap() {
    const [v, setV] = useState('')
    return (
      <TagAutocomplete
        value={v}
        onChange={setV}
        onSubmit={onSubmit}
        exclude={exclude}
        ariaLabel="Add a tag"
      />
    )
  }
  render(
    <ServicesProvider services={services}>
      <DeployProvider>
        <IndexProvider>
          <Wrap />
        </IndexProvider>
      </DeployProvider>
    </ServicesProvider>
  )
  return { onSubmit }
}

describe('TagAutocomplete', () => {
  it('suggests existing tags and submits the normalized value on Enter', async () => {
    const { onSubmit } = setup()
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 're' } })
    await screen.findByText('redux')
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // react
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('react')
  })

  it('Enter on free text submits a normalized new tag', () => {
    const { onSubmit } = setup()
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 'Brand New' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('brand-new')
  })

  it('excludes already-selected tags from suggestions', async () => {
    setup(vi.fn(), ['react'])
    fireEvent.change(screen.getByLabelText('Add a tag'), {
      target: { value: 're' }
    })
    await screen.findByText('redux')
    expect(screen.queryByText('react')).toBeNull()
  })
})
