// The host build (apps/site/astro.config.mjs) provides this virtual module — it imports only
// the selected font family's CSS + the mono font. A no-op declaration is enough for typecheck.
declare module 'virtual:setu-fonts' {}
