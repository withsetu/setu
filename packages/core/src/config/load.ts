import { resolveConfig } from './resolve'
import type { ResolvedConfig } from './types'

/** Filesystem path of the zod copy core itself imports.
 *
 *  `import.meta.resolve` rather than `createRequire`: this module sits inside `src/config`, which
 *  `tsconfig.edge.json` typechecks with no Node types, so `node:module` and `node:url` are both
 *  unavailable here even though this loader only ever runs under Node. Reading `.pathname`
 *  directly assumes a POSIX path, which holds for the platforms Setu builds on (darwin, linux);
 *  a Windows host would need `fileURLToPath` and the Node types that come with it. */
function zodPath(): string {
  return decodeURIComponent(new URL(import.meta.resolve('zod')).pathname)
}

/** Load a setu.config.ts/js module from disk (TS at runtime via jiti),
 *  take its default export, and resolve it. */
export async function loadConfig(path: string): Promise<ResolvedConfig> {
  const { createJiti } = await import('jiti')
  const jiti = createJiti(import.meta.url, {
    interopDefault: false,
    // Pin the config's `zod` to the SAME copy core validates with.
    //
    // jiti resolves a config's imports from the config's OWN directory, so `import { z } from
    // 'zod'` lands on whatever zod that site has installed — routinely a different major from
    // core's 3.x, since zod 4 is current and this very repo ships both (@setu/auth needs 4.x for
    // better-auth). A foreign schema is not merely a different instance: core's 3.x ZodObject
    // calls `keyValidator._parse` on each field, which a 4.x schema does not have, so validation
    // dies at the root and EVERY entry becomes unsaveable — including on `cid`, which the publish
    // path stamps. resolveCollection's shape-spread already keeps the *catchall* ours; this keeps
    // the *field schemas* ours, which is the half the spread cannot reach.
    //
    // Enforced by the foreign-major case in apps/api/test/setu-config.test.ts, which installs a
    // real zod 4 beside the config and fails without this alias.
    alias: { zod: zodPath() }
  })
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
