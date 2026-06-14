const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.4"/><rect x="14" y="3" width="7" height="5" rx="1.4"/><rect x="14" y="12" width="7" height="9" rx="1.4"/><rect x="3" y="16" width="7" height="5" rx="1.4"/>',
  post: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h5M9 9h1.5"/>',
  pages: '<path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/><rect x="9" y="8" width="11" height="13" rx="2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2.4"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15.5l-4.5-4.5L5 21"/>',
  forms: '<rect x="8" y="2.5" width="8" height="4" rx="1.2"/><path d="M16 4.5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h2"/><path d="M9.5 12.5h5M9.5 16.5h5M7 12.5h.01M7 16.5h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 8.4 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.4a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grip: '<circle cx="9" cy="6" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="9" cy="18" r="1.1"/><circle cx="15" cy="6" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="15" cy="18" r="1.1"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  sparkle: '<path d="M12 3l1.7 4.8L18.5 9.5 13.7 11.2 12 16l-1.7-4.8L5.5 9.5l4.8-1.7z"/><path d="M19 14l.6 1.7L21.3 16.3 19.6 17l-.6 1.7L18.4 17l-1.7-.7 1.7-.6z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  panelRight: '<rect x="3" y="3" width="18" height="18" rx="2.4"/><path d="M15 3v18"/>',
  dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  chevLeft: '<path d="m15 6-6 6 6 6"/>',
  collapse: '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
  heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
  h1: '<path d="M4 6v12M12 6v12M4 12h8"/><path d="M17 10.5 19.5 9V18"/>',
  h2: '<path d="M4 6v12M12 6v12M4 12h8"/><path d="M17 10a2 2 0 1 1 3 1.6L17 18h4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.1"/><circle cx="3.5" cy="12" r="1.1"/><circle cx="3.5" cy="18" r="1.1"/>',
  listOrdered: '<path d="M10 6h11M10 12h11M10 18h11"/><path d="M4 4.5 5.2 4v4M3.6 16.5h1.8L3.6 19h2"/>',
  quote: '<path d="M9 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2"/><path d="M20 7h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2"/>',
  callout: '<path d="M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2z"/><path d="M9.5 21h5"/>',
  divider: '<path d="M3 12h18"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 16h.01M10 16h.01M14 16h.01M18 16h.01"/>',
  code: '<path d="m16 18 5-6-5-6M8 6l-5 6 5 6"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  hero: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 13h18M8 17h8"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2.4"/><path d="m22 8-6 4 6 4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M22 21a6.5 6.5 0 0 0-5-6.3"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.4"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  tag: '<path d="M11.6 3.5 4 3.5a.5.5 0 0 0-.5.5v7.6a1 1 0 0 0 .3.7l8.4 8.4a1 1 0 0 0 1.4 0l6.6-6.6a1 1 0 0 0 0-1.4L11.6 3.5z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  link: '<path d="M9 15l6-6"/><path d="M11 6.5 13 4.5a4 4 0 0 1 6 6l-2 2"/><path d="M13 17.5 11 19.5a4 4 0 0 1-6-6l2-2"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  filter: '<path d="M3 5h18l-7 8v5l-4 2v-7z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  alert: '<path d="M10.3 3.8 1.8 18a1.5 1.5 0 0 0 1.3 2.2h17.8a1.5 1.5 0 0 0 1.3-2.2L13.7 3.8a1.5 1.5 0 0 0-2.6 0z"/><path d="M12 9v4M12 17h.01"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 4v4h-4"/>',
  rocket: '<path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8a2 2 0 0 0-3 0z"/><path d="M9 13c4-1 8-5 9-10-5 1-9 5-10 9z"/><path d="M14 6.5a8 8 0 0 1 3.5 3.5"/>',
  gitBranch: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-6 2-6 5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2.4"/><path d="m8 9 3 3-3 3M13 15h4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="m4 7 8 6 8-6"/>',
  barChart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  key: '<circle cx="7.5" cy="15.5" r="4"/><path d="m10.5 12.5 8-8M16 5l2.5 2.5M14 7l2.5 2.5"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6z"/>',
  languages: '<path d="M2 5h9M6.5 3v2c0 4-2 6.5-4.5 7.5"/><path d="M4 9c0 2.5 3 4.5 5 5.5"/><path d="m12 20 4.5-10 4.5 10M13.5 16h6"/>',
  trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M19 5h-7M13 19H6M15 5 9 19"/>',
  underline: '<path d="M7 5v6a5 5 0 0 0 10 0V5M5 21h14"/>',
  strike: '<path d="M5 12h14M8 7a4 3 0 0 1 8 0M8 16a4 3 0 0 0 8 0"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  loader: '<path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
  type: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  slash: '<path d="M16 4 8 20"/>',
  star: '<path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v2h-5v6l-1 1-1-1v-6H5v-2l3-3z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M12 12v4"/>',
} as const

export type IconName = keyof typeof ICONS

/** True when `name` is a defined icon (lets callers narrow an arbitrary string to IconName). */
export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name)
}

export function Icon({
  name,
  size = 18,
  stroke = 1.75,
  className = '',
}: {
  name: IconName
  size?: number
  stroke?: number
  className?: string
}) {
  const d = ICONS[name]
  if (!d) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block' }}
      // The ICONS set is a static, trusted, in-repo design asset (never user
      // input), so injecting the SVG inner markup is safe.
      dangerouslySetInnerHTML={{ __html: d }}
      aria-hidden="true"
    />
  )
}
