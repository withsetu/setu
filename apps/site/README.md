# @setu/site — render pipeline (sub-project #1)

Renders committed `.mdoc` content to static HTML, mapping every shipped editor block.
Read-only over content. NOT a theme: neutral baseline styling, page-per-entry only.

- Run: `pnpm --filter @setu/site dev` (preview) / `build` / `test`
- Render mapping: `markdoc.config.mjs` (callout via React core + wrapper; align/sub-sup/
  checklist/table-align via node overrides + tag components + the item transform).
- Out of scope (later sub-projects): theme/layout/nav (#3), shared-core editor refactor
  (#2), codegen (#4), editor->disk bridge, dynamic Markdoc/SSR, syntax highlighting.

