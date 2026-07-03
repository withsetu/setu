import { resolveConfig } from './resolve'
import type { ResolvedConfig } from './types'

/** Load a setu.config.ts/js module from disk (TS at runtime via jiti),
 *  take its default export, and resolve it. */
export async function loadConfig(path: string): Promise<ResolvedConfig> {
  const { createJiti } = await import('jiti')
  const jiti = createJiti(import.meta.url, { interopDefault: false })
  // Annotate `unknown` explicitly before narrowing: jiti.import's inferred type differs
  // between core's two tsconfig projects (the main one vs tsconfig.edge.json), so a bare
  // `as { default?: unknown }` cast reads as unnecessary under one and load-bearing under
  // the other (eslint --fix removed it and broke the edge typecheck). Starting from a
  // declared `unknown` makes the narrowing valid — and identical — under both.
  const mod: unknown = await jiti.import(path)
  const def = (mod as { default?: unknown } | null | undefined)?.default
  if (def === undefined) {
    throw new Error(`setu config at "${path}" has no default export`)
  }
  return resolveConfig(def)
}
