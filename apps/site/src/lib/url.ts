// Default locale is unprefixed in URLs; non-default locales keep their segment.
// Hardcoded for now — becomes config-driven when permalinks / i18n routing land.
export const DEFAULT_LOCALE = 'en'

// Content is stored as <collection>/<locale>/<slug...>. Drop the locale segment from the
// URL when it's the default locale, so a single-language site has clean URLs and a locale
// only appears once non-default content exists.
export function toUrlPath(id: string): string {
  const parts = id.split('/')
  if (parts.length >= 3 && parts[1] === DEFAULT_LOCALE) {
    return [parts[0], ...parts.slice(2)].join('/')
  }
  return id
}
