/** Turn a field or prop name into a display label: `priceUsd` → "Price Usd",
 *  `lead-time` → "Lead Time". Shared by the block inspector (block props) and the meta
 *  panel's collection fields (#963) so the two cannot drift into labelling the same
 *  camelCase name differently. */
export function humanizeLabel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
