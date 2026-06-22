import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'
import { Icon } from '../../ui/Icon'
import { slashBlocks } from '../blocks'
import type { SlashBlock } from '../slash-model'
import { slashRenderModel } from '../slash-model'
import type { SlashRow } from '../slash-model'

export interface CommandListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

export const CommandList = forwardRef<CommandListHandle, SuggestionProps<SlashBlock>>((props, ref) => {
  const rows = slashRenderModel(props.items, props.query)
  const itemRows = rows.filter((r): r is Extract<SlashRow, { kind: 'item' }> => r.kind === 'item')
  const [selected, setSelected] = useState(0)
  // Reset the highlight whenever the result set changes (filter or query).
  useEffect(() => setSelected(0), [props.items, props.query])

  // Keep the highlighted item scrolled into view as the user arrows through.
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const pick = (index: number) => {
    const row = itemRows[index]
    if (row) props.command(row.block)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (itemRows.length === 0) return false
      if (event.key === 'ArrowUp') {
        setSelected((i) => (i + itemRows.length - 1) % itemRows.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelected((i) => (i + 1) % itemRows.length)
        return true
      }
      if (event.key === 'Enter') {
        pick(selected)
        return true
      }
      return false
    },
  }))

  return (
    <div className="slash" role="listbox" aria-label="Insert block">
      <div className="slash-list">
        {itemRows.length === 0 && <div className="slash-empty">No blocks</div>}
        {rows.map((row) =>
          row.kind === 'header' ? (
            <div key={`h-${row.category}`} className="slash-head" role="presentation">
              {row.label}
            </div>
          ) : (
            <button
              key={row.block.title}
              ref={(el) => {
                itemRefs.current[row.itemIndex] = el
              }}
              type="button"
              role="option"
              aria-selected={row.itemIndex === selected}
              className={`slash-item${row.itemIndex === selected ? ' sel' : ''}`}
              onMouseEnter={() => setSelected(row.itemIndex)}
              onClick={() => pick(row.itemIndex)}
            >
              <span className="slash-ic"><Icon name={row.block.icon} size={16} /></span>
              <span className="slash-text">
                <span className="slash-label">{row.block.title}</span>
                <span className="slash-desc">{row.block.subtitle}</span>
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  )
})
CommandList.displayName = 'CommandList'

/** Slash-command menu: `/` opens a config-driven block picker (ARIA listbox). */
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashBlock>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        items: () => slashBlocks(),
        command: ({ editor, range, props }) => props.run(editor as Editor, range as Range),
        render: () => {
          // The ReactRenderer generic params: R=CommandListHandle (ref type),
          // P=SuggestionProps<SlashBlock> (props type). Tiptap's ComponentType<R,P>
          // accepts ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<R>>,
          // which is exactly what forwardRef produces.
          let component: ReactRenderer<CommandListHandle, SuggestionProps<SlashBlock>>
          // noUncheckedIndexedAccess: popup is TippyInstance[] from tippy('body', ...)
          // (MultipleTargets overload). All accesses are guarded with [0]?.
          let popup: TippyInstance[] = []
          return {
            onStart: (props) => {
              component = new ReactRenderer(CommandList, { props, editor: props.editor })
              const rect = props.clientRect
              if (!rect) return
              popup = tippy('body', {
                getReferenceClientRect: () => rect() ?? new DOMRect(),
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              })
            },
            onUpdate: (props) => {
              component.updateProps(props)
              const rect = props.clientRect
              if (rect) popup[0]?.setProps({ getReferenceClientRect: () => rect() ?? new DOMRect() })
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                popup[0]?.hide()
                return true
              }
              return component.ref?.onKeyDown(props) ?? false
            },
            onExit: () => {
              popup[0]?.destroy()
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})
