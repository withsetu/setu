import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadThemeOptions, mergeThemeOptions } from '../src/lib/site-config'

const created: string[] = []
afterEach(() => {
  delete process.env.SETU_CONTENT_DIR
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('mergeThemeOptions', () => {
  it('file values win over config defaults', () => {
    expect(
      mergeThemeOptions(
        { accent: '#111', font: 'inter' },
        { accent: '#0ea5e9' }
      )
    ).toEqual({
      accent: '#0ea5e9',
      font: 'inter'
    })
  })
  it('empty file → just the config values', () => {
    expect(mergeThemeOptions({ accent: '#111' }, {})).toEqual({
      accent: '#111'
    })
  })
})

describe('loadThemeOptions (reads the committed theme-options.json)', () => {
  function sandbox(values: object | null): string {
    const root = mkdtempSync(path.join(tmpdir(), 'setu-theme-'))
    created.push(root)
    mkdirSync(path.join(root, 'content'), { recursive: true })
    if (values !== null) {
      writeFileSync(
        path.join(root, 'theme-options.json'),
        JSON.stringify(values)
      )
    }
    // site reads <SETU_CONTENT_DIR>/../theme-options.json
    process.env.SETU_CONTENT_DIR = path.join(root, 'content')
    return root
  }

  it('reads published values from the content-repo root', () => {
    sandbox({ accent: '#0ea5e9', width: 'wide' })
    expect(loadThemeOptions()).toMatchObject({
      accent: '#0ea5e9',
      width: 'wide'
    })
  })

  it('falls back to defaults when the file is absent', () => {
    sandbox(null)
    expect(loadThemeOptions()).toEqual({})
  })

  it('falls back to defaults when the file is malformed', () => {
    const root = sandbox(null)
    writeFileSync(path.join(root, 'theme-options.json'), '{ not json')
    expect(loadThemeOptions()).toEqual({})
  })
})
