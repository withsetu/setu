import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'
import { Icon } from '../../ui/Icon'
import { slashBlocks } from '../blocks'
import type { SlashBlock } from '../blocks'

export interface CommandListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

export const CommandList = forwardRef<CommandListHandle, SuggestionProps<SlashBlock>>((props, ref) => {
  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [props.items])

  const pick = (index: number) => {
    const item = props.items[index]
    if (item) props.command(item)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelected((i) => (i + props.items.length - 1) % props.items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelected((i) => (i + 1) % props.items.length)
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
      <div className="slash-head">Blocks</div>
      <div className="slash-list">
        {props.items.length === 0 && <div className="slash-empty">No blocks</div>}
        {props.items.map((item, index) => (
          <button
            key={item.title}
            type="button"
            role="option"
            aria-selected={index === selected}
            className={`slash-item${index === selected ? ' sel' : ''}`}
            onMouseEnter={() => setSelected(index)}
            onClick={() => pick(index)}
          >
            <span className="slash-ic"><Icon name={item.icon} size={16} /></span>
            <span className="slash-text">
              <span className="slash-label">{item.title}</span>
              <span className="slash-desc">{item.subtitle}</span>
            </span>
          </button>
        ))}
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
        items: ({ query }) =>
          slashBlocks().filter((b) => b.title.toLowerCase().includes(query.toLowerCase())),
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
