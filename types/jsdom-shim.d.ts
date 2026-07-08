// Shim that intercepts the bare `jsdom` type import so lib.dom never leaks into Node
// packages. Vitest 3's `optional-types.d.ts` does a type-level `import('jsdom')` to type
// the `environment: 'jsdom'` option; `@types/jsdom` carries `/// <reference lib="dom" />`,
// so resolving it drags the whole DOM lib into EVERY package whose tests import vitest —
// wrongly typing Node-only packages (api/core/db/git/…) against browser globals (see #405).
// tsconfig.base.json maps `jsdom` here so that never happens. Packages that genuinely use
// jsdom (apps/site's a11y test) extend astro's config, not this base, so they still resolve
// the real @types/jsdom.
declare const jsdomShim: unknown
export = jsdomShim
