import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createServices, ServicesProvider } from '../src/data/store'
import { DeployProvider, useDeploy } from '../src/deploy/deploy'
import { contentPath } from '@setu/core'

describe('deploy', () => {
  it('snapshots committed content as live, and reports the deployed content per path', async () => {
    const services = createServices()
    const author = { name: 'T', email: 't@x' }
    const ref = { collection: 'post', locale: 'en', slug: 'p1' }
    await services.data.saveDraft({ ...ref, content: { type: 'doc', content: [] }, metadata: { title: 'P1' } })
    await services.publish.publish({ ref, author })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider services={services}><DeployProvider>{children}</DeployProvider></ServicesProvider>
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    expect(result.current.deployedAt(contentPath(ref))).toBeNull()
    await act(async () => { await result.current.deploy() })
    await waitFor(() => expect(result.current.deployedAt(contentPath(ref))).not.toBeNull())
  })

  it('snapshots a published entry that has no draft (enumerated from Git)', async () => {
    const services = createServices()
    const author = { name: 'T', email: 't@x' }
    const ref = { collection: 'post', locale: 'en', slug: 'ghost' }
    await services.data.saveDraft({ ...ref, content: { type: 'doc', content: [] }, metadata: { title: 'Ghost' } })
    await services.publish.publish({ ref, author })
    await services.data.deleteDraft(ref) // now it lives only in Git

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServicesProvider services={services}><DeployProvider>{children}</DeployProvider></ServicesProvider>
    )
    const { result } = renderHook(() => useDeploy(), { wrapper })
    expect(result.current.deployedAt(contentPath(ref))).toBeNull()
    await act(async () => { await result.current.deploy() })
    await waitFor(() => expect(result.current.deployedAt(contentPath(ref))).not.toBeNull())
  })
})
