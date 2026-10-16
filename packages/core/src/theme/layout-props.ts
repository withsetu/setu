import type { PostRow } from '../posts/select-posts'
import type { ResolvedSeo } from '../seo/resolve-seo'
import type { SiteSettings } from '../settings/types'

/**
 * The props `apps/site` passes to a theme's four route components (#1297, part of the theme
 * contract in #342). A theme declares each component's `Props` as the matching type; the site
 * builds the props it passes as the same type in apps/site/src/lib/layout-props.ts, so a change
 * here that the site's call sites don't follow fails `pnpm typecheck`. The theme's side lives in
 * .astro frontmatter, which plain `tsc` does not read — that file's header says what checks it.
 *
 * Derived from the call sites in apps/site/src (pages/index.astro, pages/[...path].astro,
 * pages/posts/[...page].astro, components/TaxonomyArchivePage.astro, preview/preview.astro):
 * a field is required only when EVERY call site passes it.
 *
 * Type-only and edge-safe: no Astro or DOM types. The archive page is a structural mirror of
 * Astro's `Page<T>` (apps/site/src/lib/layout-props.ts asserts the two stay mutually assignable).
 */

/** `PageLayout.astro`: a standalone page, the homepage, an archive's frame, the preview shell. */
export interface PageLayoutProps {
  /** The entry or page title. The theme decides how it reaches `<title>` when `seo` is absent. */
  title: string
  /** BCP 47 locale of the page (`<html lang>`). */
  lang: string
  /** The site's chosen theme-option values (Customizer / setu.config), keyed by option `key`. */
  themeOptions: Record<string, string>
  /** Absent only in the editor preview. */
  siteSettings?: SiteSettings
  /** Locales that have a feed, for `<link rel="alternate" type="application/rss+xml">`. */
  feedLocales?: string[]
  /** The resolved SEO head (title, canonical, meta, JSON-LD). Absent only in the editor preview. */
  seo?: ResolvedSeo
}

/** One card in a post's "read next" list. `image` is already a resolved URL. */
export interface RelatedPostItem {
  title: string
  href: string
  image?: string
}

/**
 * `PostLayout.astro`: a `post` entry. A superset of `PageLayoutProps` — the entry route picks
 * Post or Page layout per collection and passes the same props to either, so `PageLayout`
 * receives (and may ignore) these extra fields too.
 */
export interface PostLayoutProps extends PageLayoutProps {
  /** Related posts, already limited to the Reading setting's count; empty when disabled. */
  related?: RelatedPostItem[]
  /** Heading for the related list (Reading → Related posts → Heading). */
  heading?: string
  /** Whether related cards show their image. */
  showImage?: boolean
}

/** A page of a paginated list — the same shape as Astro's `Page<T>`. */
export interface ArchivePage<T> {
  data: T[]
  /** Index of the first item on this page, from 0. */
  start: number
  /** Index of the last item on this page, from 0. */
  end: number
  total: number
  /** From 1. */
  currentPage: number
  size: number
  lastPage: number
  url: {
    current: string
    prev: string | undefined
    next: string | undefined
    first: string | undefined
    last: string | undefined
  }
}

/** `ArchiveList.astro`: the posts archive and every taxonomy archive, rendered inside PageLayout. */
export interface ArchiveListProps {
  page: ArchivePage<PostRow>
  /** "Posts", "Category: News", "Tag: astro". */
  heading: string
  /** Path of page 1 of this archive (no trailing slash); page N is `${basePath}/${N}`. */
  basePath: string
  /** Prefix for a root-relative `featuredImage` (`/media/…`); '' when media is same-origin. */
  mediaBase: string
}

/** `TaxonomyChips.astro`: a post's category and tag links, rendered inside PostLayout. */
export interface TaxonomyChipsProps {
  /** Category slug plus its display name (the slug when no name is configured). */
  categories: { slug: string; name: string }[]
  /** Tags, verbatim — tags are never slugified. */
  tags: string[]
  /** The post's locale: chips link to that locale's archive (`taxonomyArchivePath`). */
  locale: string
}
