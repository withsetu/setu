import type { ZodTypeAny } from 'zod'
import type { BlockCategory } from '../blocks/categories'

export type BlockControl =
  | 'text'
  | 'textarea'
  | 'number'
  | 'switch'
  | 'select'
  | 'media'
  | 'url'
  | 'color'
  | 'position9'
  | 'align'
  | 'slider'
  | 'category'
  | 'tag'
  | 'locale'

/** Style axes a block may be re-themed on (color/surface/etc). Carried as data for MCP
 *  introspection + future auto-CSS; NOT enforced at runtime. Mirrors @setu/blocks'
 *  BlockStyleAxis, redeclared here to keep @setu/core free of a @setu/blocks dependency. */
export type BlockStyleAxis =
  | 'accent'
  | 'surface'
  | 'text'
  | 'tone'
  | 'radius'
  | 'typography'

/** Editor-facing metadata for a block (consumed by the slash menu). */
export interface BlockEditorMeta {
  label?: string
  icon?: string
  /** Block category — drives slash-menu grouping. Defaults to 'text'. */
  group?: BlockCategory
  /** Extra search terms / aliases for the slash menu (e.g. ['img','photo']). */
  keywords?: string[]
  /** Hide the block from the slash menu. For structural child blocks (e.g. `column`)
   *  that are only ever created and managed by a parent container block. */
  hidden?: boolean
  /** Selectable variant values for the block (e.g. callout types), shown in the
   *  editor's variant picker. The editor maps each to a theme tone/icon. */
  variants?: string[]
  /** Optional per-prop editor control override. When absent for a prop, the control is
   *  derived from its zod type (Enum→select, Number→number, Boolean→switch, String→text).
   *  String-backed props may upgrade to 'textarea' | 'media' | 'url' | 'color';
   *  enum-backed props may upgrade to 'position9' | 'align'. */
  controls?: Record<string, BlockControl>
  /** Optional friendly field labels for the inspector (propName → label). When absent
   *  for a prop, the label is humanized from the prop name (e.g. textPosition → "Text Position"). */
  labels?: Record<string, string>
  /** Hide a control unless every (otherProp → value|values) pair matches the current attrs. */
  showWhen?: Record<string, Record<string, string | string[]>>
  /** Optional ordered sections for the inspector rail. Controls not listed in any
   *  group fall into an implicit leading "Content" section in declaration order. */
  groups?: Array<{ id: string; label: string; controls: string[] }>
  /** Which style axes this block is themeable on — introspectable metadata for the MCP /
   *  future auto-CSS layer. Carried, not enforced. */
  style?: { themeable?: BlockStyleAxis[] }
}

/** A content block as authored in setu.config.ts. */
export interface BlockDefinition {
  /** Markdoc tag name, e.g. 'callout'. Unique across the config. */
  tag: string
  /** Zod schema for the block's Markdoc attributes (props). */
  props: ZodTypeAny
  /** Framework-agnostic path to the render component (.astro or framework). */
  component: string
  /** Optional editor metadata (slash-menu label/icon/group). */
  editor?: BlockEditorMeta
  /** Content types this block is meant for. Reserved — carried, not enforced (Slice A). */
  scope?: string[]
}

/** The config object an author exports from setu.config.ts. */
export interface SetuConfig {
  /** Authored blocks. Optional — blocks are normally auto-discovered from folders. */
  blocks?: BlockDefinition[]
  /** The active theme's package name (e.g. '@setu/theme-default'). Optional. */
  theme?: string
  /** Chosen values for the active theme's declared options (key → value). Optional. */
  themeOptions?: Record<string, string>
  /** Per-collection permalink pattern overrides (key → pattern). Optional. */
  permalinks?: Record<string, string>
}

/** A block after resolution (distinct type for future derived fields). */
export type ResolvedBlock = BlockDefinition

/** The validated, indexed config the rest of the system consumes. */
export interface ResolvedConfig {
  /** All blocks, in authored order. */
  blocks: ResolvedBlock[]
  /** Blocks indexed by tag for O(1) lookup. */
  blocksByTag: Map<string, ResolvedBlock>
  /** Tag set the round-trip treats as known/editable blocks. */
  knownBlockTags: Set<string>
  /** The active theme's package name, passed through from the authored config. */
  theme?: string
  /** Theme option values, passed through from the authored config. */
  themeOptions?: Record<string, string>
  /** Per-collection permalink pattern overrides, passed through from the authored config. */
  permalinks?: Record<string, string>
}
