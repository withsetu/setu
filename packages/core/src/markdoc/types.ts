/** A Tiptap (ProseMirror) inline mark. */
export interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

/** A Tiptap (ProseMirror) node. */
export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
}

/** A Tiptap document root. */
export interface TiptapDoc {
  type: 'doc'
  content: TiptapNode[]
}

/** Options for Markdoc → Tiptap conversion. */
export interface RoundtripOptions {
  /** Markdoc tags that have a first-class editor block (default: {'callout'}). */
  knownBlockTags?: Set<string>
}

/**
 * Minimal structural view of a Markdoc AST node — enough for the round-trip
 * without depending on Markdoc's exported type surface.
 */
export interface MdNode {
  type: string
  tag?: string
  attributes: Record<string, unknown>
  children?: MdNode[]
  errors?: unknown[]
  location?: { start?: { line?: number } }
}
