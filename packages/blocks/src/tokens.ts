/** The canonical style axes a standard block may be themeable on. Carried as data so the
 *  contract is MCP-introspectable; not enforced at runtime. */
export type BlockStyleAxis =
  | 'accent'
  | 'surface'
  | 'text'
  | 'tone'
  | 'radius'
  | 'typography'

export interface BlockToken {
  name: `--${string}`
  axis: BlockStyleAxis
  description: string
}

/** The one source of truth for the CSS custom properties a standard block is allowed to
 *  read. Names are unprefixed and shared with the editor (apps/admin) and themes
 *  (theme-default). Grounded in what the shipped blocks already read — see
 *  docs/block-styling-contract.md. Block-local computed values (e.g. --blk-hero-scrim)
 *  are NOT contract tokens; they follow the --blk-<block>-* convention. */
export const BLOCK_TOKENS: readonly BlockToken[] = [
  {
    name: '--accent',
    axis: 'accent',
    description: 'Primary brand / action color'
  },
  {
    name: '--accent-strong',
    axis: 'accent',
    description: 'Darker accent (hover, emphasis)'
  },
  {
    name: '--accent-soft',
    axis: 'accent',
    description: 'Tinted accent surface'
  },
  {
    name: '--on-accent',
    axis: 'accent',
    description: 'Foreground on an accent fill'
  },
  { name: '--bg', axis: 'surface', description: 'Page background' },
  {
    name: '--surface-2',
    axis: 'surface',
    description: 'Raised/secondary surface'
  },
  { name: '--canvas', axis: 'surface', description: 'Card/content surface' },
  { name: '--border', axis: 'surface', description: 'Hairline border' },
  { name: '--text', axis: 'text', description: 'Primary text' },
  { name: '--text-2', axis: 'text', description: 'Muted/secondary text' },
  { name: '--green', axis: 'tone', description: 'Success tone' },
  { name: '--green-soft', axis: 'tone', description: 'Success tinted surface' },
  { name: '--amber', axis: 'tone', description: 'Warning tone' },
  { name: '--amber-soft', axis: 'tone', description: 'Warning tinted surface' },
  { name: '--red', axis: 'tone', description: 'Danger tone' },
  { name: '--red-soft', axis: 'tone', description: 'Danger tinted surface' },
  { name: '--r-sm', axis: 'radius', description: 'Small corner radius' },
  { name: '--r-md', axis: 'radius', description: 'Medium corner radius' },
  {
    name: '--font-ui',
    axis: 'typography',
    description: 'UI / block font family'
  }
] as const

export const TOKENS_BY_AXIS: Record<BlockStyleAxis, string[]> =
  BLOCK_TOKENS.reduce(
    (acc, t) => {
      ;(acc[t.axis] ??= []).push(t.name)
      return acc
    },
    {} as Record<BlockStyleAxis, string[]>
  )
