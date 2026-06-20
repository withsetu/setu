import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TiptapDoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TagField } from '../src/editor/TagField'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

function setup(selected: string[] = []) {
  const onChange = vi.fn()
  const data = createMemoryDataPort([
    { collection: 'post', locale: 'en', slug: 'seed', content: doc('x'), metadata: { title: 'Seed', tags: ['react', 'redux'] } },
  ])
  const services = servicesFor(data, createMemoryGitPort())
  render(
    <ServicesProvider services={services}>
      <DeployProvider>
        <IndexProvider>
          <TagField selected={selected} onChange={onChange} editable />
        </IndexProvider>
      </DeployProvider>
    </ServicesProvider>,
  )
  return { onChange }
}

describe('TagField', () => {
  it('free-creates a normalized tag on Enter', () => {
    const { onChange } = setup()
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 'Next JS' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['next-js'])
  })

  it('does not add an empty/symbol-only tag', () => {
    const { onChange } = setup()
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: '!!!' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('suggests existing tags from the index and adds on click, excluding selected', async () => {
    const { onChange } = setup(['react'])
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 're' } })
    const opt = await screen.findByRole('option', { name: 'redux' })
    expect(screen.queryByRole('option', { name: 'react' })).toBeNull() // already selected
    fireEvent.click(opt)
    expect(onChange).toHaveBeenCalledWith(['react', 'redux'])
  })

  it('removes a chip', () => {
    const { onChange } = setup(['react'])
    fireEvent.click(screen.getByLabelText('Remove react'))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('does not duplicate an already-selected tag', () => {
    const { onChange } = setup(['react'])
    const input = screen.getByLabelText('Add a tag')
    fireEvent.change(input, { target: { value: 'React' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
