import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { E2ERole } from './seed-users'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** `e2e/.auth/` — where per-role `storageState` (real Better Auth session cookies, minted by
 *  logging in through the UI in auth.setup.ts) is saved. Gitignored; regenerated each run. */
export const authDir = path.resolve(dirname, '..', '.auth')

export const storageStateFor = (role: E2ERole): string => path.join(authDir, `${role}.json`)
