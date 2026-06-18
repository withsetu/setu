import type { ReactNode } from 'react'
import { BlockIcon } from '../icons/BlockIcon'
import type { BlockIconName } from '../icons/svgs'

interface CalloutProps {
  /** CSS tone suffix (accent | green | amber | red | slate | neutral). */
  tone: string
  /** Icon rendered into the .callout-ic badge by the core. */
  icon: BlockIconName
  /** Title slot: editor passes an <input class="callout-title">, site passes a static node. */
  title?: ReactNode
  /** Toolbar slot: editor passes its .block-props chrome, site passes nothing. */
  toolbar?: ReactNode
  /** The body element: editor passes <NodeViewContent class="callout-body">, site a <div>. */
  children: ReactNode
}

/** The single callout visual core — rendered by BOTH the editor node view and the site
 *  wrapper. Owns structure + class contract; consumers inject the editable/dynamic slots. */
export function Callout({ tone, icon, title, toolbar, children }: CalloutProps) {
  return (
    <aside className={`blk-callout tone-${tone}`} aria-label="Callout block">
      {toolbar}
      <div className="callout-head">
        <span className="callout-ic">
          <BlockIcon name={icon} size={18} />
        </span>
        {title}
      </div>
      {children}
    </aside>
  )
}
