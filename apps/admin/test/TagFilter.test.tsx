import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TiptapDoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TagFilter } from '../src/screens/TagFilter'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

function setup(value: string) {
  const onChange = vi.fn()
  const data = createMemoryDataPort([
    {
      collection: 'post',
      locale: 'en',
      slug: 'seed',
      content: doc('x'),
      metadata: { title: 'Seed', tags: ['react', 'redux'] }
    }
  ])
  render(
    <ServicesProvider services={servicesFor(data, createMemoryGitPort())}>
      <DeployProvider>
        <IndexProvider>
          <TagFilter value={value} onChange={onChange} />
        </IndexProvider>
      </DeployProvider>
    </ServicesProvider>
  )
  return { onChange }
}

describe('TagFilter', () => {
  it('suggests tags from the index and selects one on click', async () => {
    const { onChange } = setup('')
    fireEvent.change(screen.getByLabelText('Filter by tag'), {
      target: { value: 're' }
    })
    const opt = await screen.findByRole('option', { name: 'redux' })
    fireEvent.mouseDown(opt)
    expect(onChange).toHaveBeenCalledWith('redux')
  })

  it('shows the active tag as a chip and clears it', () => {
    const { onChange } = setup('react')
    fireEvent.click(screen.getByLabelText('Clear tag filter'))
    expect(onChange).toHaveBeenCalledWith('')
  })
})
