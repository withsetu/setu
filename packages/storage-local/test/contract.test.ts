import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { runStoragePortContract } from '@setu/storage-testing'
import { createLocalStorage } from '../src/index'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

runStoragePortContract(() => {
  const dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
  dirs.push(dir)
  return createLocalStorage({ dir, baseUrl: '/uploads' })
})
