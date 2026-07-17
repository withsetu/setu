/** Page-render registry for the gallery lightbox's inline script (#177 audit perf).
 *
 *  The script is page-global (it wires every `.blk-gallery[data-lightbox]` on the
 *  page), so only the FIRST lightbox-enabled gallery of a page should emit it.
 *  `Astro.request` is the one object all component instances of a single page render
 *  share — in dev, SSR, and prerendered builds alike — so a module-scoped WeakSet
 *  keyed on it dedupes per page. A plain module flag would dedupe across the WHOLE
 *  build process (script missing from every page but the first); the WeakSet keying
 *  keeps it per page, and being weak it never retains finished requests. */
export const emittedFor = new WeakSet<Request>()
