import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useColumnPrefs } from '../src/screens/content-list/useColumnPrefs'

describe('useColumnPrefs', () => {
  beforeEach(() => localStorage.clear())
  it('defaults: content columns on, locale follows multilingual', () => {
    const { result } = renderHook(() => useColumnPrefs(false))
    expect(result.current.visible).toMatchObject({
      status: true,
      tags: true,
      categories: true,
      featured: true,
      updated: true,
      locale: false
    })
    const { result: ml } = renderHook(() => useColumnPrefs(true))
    expect(ml.current.visible.locale).toBe(true)
  })
  it('toggle flips and persists', () => {
    const { result } = renderHook(() => useColumnPrefs(false))
    act(() => result.current.toggle('tags'))
    expect(result.current.visible.tags).toBe(false)
    expect(JSON.parse(localStorage.getItem('setu-list-columns')!).tags).toBe(
      false
    )
  })
  it('persisted choice wins over default on remount', () => {
    localStorage.setItem('setu-list-columns', JSON.stringify({ status: false }))
    const { result } = renderHook(() => useColumnPrefs(false))
    expect(result.current.visible.status).toBe(false)
    expect(result.current.visible.tags).toBe(true)
  })
})
