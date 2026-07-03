import { describe, expect, it, beforeEach } from 'vitest'
import { currentTheme, toggleTheme } from '../src/shell/theme'

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  localStorage.clear()
})

describe('theme util', () => {
  it('defaults to light', () => {
    expect(currentTheme()).toBe('light')
  })
  it('toggle sets dark then light, persisting to localStorage + data-theme', () => {
    expect(toggleTheme()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('setu-theme')).toBe('dark')
    expect(toggleTheme()).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('setu-theme')).toBe('light')
  })
})
