import type { ZodTypeAny } from 'zod'
import type { BlockCategory } from '../blocks/categories'

/** Editor-facing metadata for a block (consumed by the slash menu). */
export interface BlockEditorMeta {
  label?: string
  icon?: string
  /** Block category — drives slash-menu grouping. Defaults to 'text'. */
  group?: BlockCategory
  /** Extra search terms / aliases for the slash menu (e.g. ['img','photo']). */
  keywords?: string[]
  /** Selectable variant values for the block (e.g. callout types), shown in the
   *  editor's variant picker. The editor maps each to a theme tone/icon. */
  variants?: string[]
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
}
