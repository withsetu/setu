import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSiteSettings } from '../src/lib/site-settings'

const dirs: string[] = []
afterEach(() => {
  delete process.env.SETU_CONTENT_DIR
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// loadSiteSettings reads <SETU_CONTENT_DIR>/../settings.json. Lay out root/content + root/settings.json.
function fixture(settings: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'setu-settings-'))
  dirs.push(root)
  if (settings !== undefined)
    writeFileSync(join(root, 'settings.json'), JSON.stringify(settings))
  process.env.SETU_CONTENT_DIR = join(root, 'content')
  return root
}

describe('loadSiteSettings', () => {
  it('reads settings.json and merges over defaults', () => {
    fixture({ general: { title: 'My Site' } })
    const s = loadSiteSettings()
    expect(s.general.title).toBe('My Site')
    expect(s.general.timezone).toBe('UTC') // default filled
  })
  it('returns defaults when the file is absent', () => {
    fixture(undefined)
    expect(loadSiteSettings().general.title).toBe('Setu')
  })
})
