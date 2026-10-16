import { describe, expectTypeOf, it } from 'vitest'
import type {
  ArchiveListProps,
  PageLayoutProps,
  PostLayoutProps,
  TaxonomyChipsProps
} from '../../src'

// Type-level: these assertions fail `pnpm typecheck` (core's tsconfig includes test/), not the
// vitest run. The site's own call sites are checked in apps/site/src/lib/layout-props.ts.
describe('theme layout props (#1297)', () => {
  it('a post layout props object is also a valid page layout props object', () => {
    // apps/site/src/pages/[...path].astro hands the same props to PostLayout or PageLayout.
    expectTypeOf<PostLayoutProps>().toExtend<PageLayoutProps>()
  })

  it('carries exactly what every call site passes as required', () => {
    expectTypeOf<PageLayoutProps>()
      .pick<'title' | 'lang' | 'themeOptions'>()
      .toEqualTypeOf<{
        title: string
        lang: string
        themeOptions: Record<string, string>
      }>()
    expectTypeOf<ArchiveListProps['heading']>().toEqualTypeOf<string>()
    expectTypeOf<TaxonomyChipsProps['locale']>().toEqualTypeOf<string>()
  })
})
