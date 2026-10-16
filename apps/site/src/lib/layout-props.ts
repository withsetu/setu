// The props this site passes to the active theme's four route components, built against the
// theme contract's types in @setu/core (packages/core/src/theme/layout-props.ts, #1297).
//
// Each builder writes its result as an object literal typed as the contract type, field by
// field, in a .ts file. That is deliberate: `pnpm typecheck` runs plain `tsc`, which reads .ts
// but not .astro frontmatter. Built here, a field the contract drops (excess property), a field it
// adds as required (missing property) or a field whose type changes all fail typecheck; built
// inline in a route's .astro file, none of them would.
//
// What tsc does NOT see: the route's `<PageLayout {...props}>` spread and the theme's own
// `type Props = PageLayoutProps` declaration, both in .astro files. A theme reading a prop the
// contract doesn't carry is caught only by the render check
// (apps/site/test/theme-conformance-render.test.ts) when it changes the output.
import type { Page } from 'astro'
import {
  categoryNameMap,
  type ArchiveListProps,
  type PageLayoutProps,
  type PostLayoutProps,
  type PostRow,
  type ReadingSettings,
  type RelatedPostItem,
  type ResolvedSeo,
  type SiteSettings,
  type TaxonomyChipsProps
} from '@setu/core'
import { loadCategories } from './categories'
import { strArr } from './post-row'

/** What the site resolved for the page around the content. Only the editor preview omits the
 *  optional fields. */
export interface LayoutContext {
  themeOptions: Record<string, string>
  siteSettings?: SiteSettings
  feedLocales?: string[]
  seo?: ResolvedSeo
}

export function pageLayoutProps(
  title: string,
  lang: string,
  ctx: LayoutContext
): PageLayoutProps {
  return {
    title,
    lang,
    themeOptions: ctx.themeOptions,
    siteSettings: ctx.siteSettings,
    feedLocales: ctx.feedLocales,
    seo: ctx.seo
  }
}

/** A post's layout props: the page frame plus the related-posts list the Reading settings ask
 *  for. The entry route passes these to PageLayout too when the entry is not a post. */
export function postLayoutProps(
  frame: PageLayoutProps,
  related: RelatedPostItem[],
  relatedPosts: ReadingSettings['relatedPosts']
): PostLayoutProps {
  return {
    ...frame,
    related,
    heading: relatedPosts.heading,
    showImage: relatedPosts.showImage
  }
}

export function archiveListProps(
  page: Page<PostRow>,
  heading: string,
  basePath: string,
  mediaBase: string
): ArchiveListProps {
  // `page` is Astro's own Page<PostRow>; assigning it here is what keeps the contract's
  // structural ArchivePage in step with Astro's type across upgrades.
  return { page, heading, basePath, mediaBase }
}

/** A post's category chips (slug + configured display name) and tag chips, from frontmatter. */
export function taxonomyChipsProps(
  data: Record<string, unknown>,
  locale: string
): TaxonomyChipsProps {
  const names = categoryNameMap(loadCategories())
  return {
    categories: strArr(data.categories).map((slug) => ({
      slug,
      name: names.get(slug) ?? slug
    })),
    tags: strArr(data.tags),
    locale
  }
}
