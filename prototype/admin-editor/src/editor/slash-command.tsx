import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react'

/**
 * Slash menu, the Notion-like block inserter.
 * In real Saytu these items are generated from `saytu.config.ts` (blocks +
 * collections). Here they're hard-coded to prove the interaction + a11y model.
 */
export type CommandItem = {
  title: string
  subtitle: string
  icon: string
  pro?: boolean
  command: (props: { editor: Editor; range: Range }) => void
}

const ALL_ITEMS: CommandItem[] = [
  {
    title: 'Heading 1',
    subtitle: 'Big section heading',
    icon: 'H1',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    subtitle: 'Medium section heading',
    icon: 'H2',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Bullet list',
    subtitle: 'A simple bulleted list',
    icon: '•',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Callout',
    subtitle: 'Highlight an important note',
    icon: '💡',
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'callout', content: [{ type: 'text', text: 'Note…' }] })
        .run(),
  },
  {
    title: 'Dynamic block',
    subtitle: 'Conditional / variable Markdoc — requires SSR',
    icon: '⚡',
    pro: true,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'passthrough', attrs: { label: 'Conditional content', raw: '{% if %}' } })
        .run(),
  },
]

const CommandList = forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => setSelectedIndex(0), [props.items])

  const selectItem = (index: number) => {
    const item = props.items[index]
    if (item) props.command(item)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + props.items.length - 1) % props.items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % props.items.length)
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex)
        return true
      }
      return false
    },
  }))

  return (
    <div
      role="listbox"
      aria-label="Insert block"
      className="z-50 w-72 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1 shadow-xl"
    >
      {props.items.length === 0 && (
        <div className="px-3 py-2 text-sm text-neutral-400">No blocks</div>
      )}
      {props.items.map((item: CommandItem, index: number) => (
        <button
          key={item.title}
          role="option"
          aria-selected={index === selectedIndex}
          onMouseEnter={() => setSelectedIndex(index)}
          onClick={() => selectItem(index)}
          className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${
            index === selectedIndex ? 'bg-neutral-100' : ''
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-sm">
            {item.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-800">
              {item.title}
              {item.pro && (
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                  PRO
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-neutral-500">{item.subtitle}</span>
          </span>
        </button>
      ))}
    </div>
  )
})
CommandList.displayName = 'CommandList'

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        command: ({ editor, range, props }) => props.command({ editor, range }),
        items: ({ query }: { query: string }) =>
          ALL_ITEMS.filter((i) =>
            i.title.toLowerCase().includes(query.toLowerCase()),
          ),
        render: () => {
          let component: ReactRenderer
          let popup: TippyInstance[]

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(CommandList, { props, editor: props.editor })
              if (!props.clientRect) return
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              })
            },
            onUpdate: (props: any) => {
              component.updateProps(props)
              if (props.clientRect) {
                popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
              }
            },
            onKeyDown: (props: any) => {
              if (props.event.key === 'Escape') {
                popup?.[0]?.hide()
                return true
              }
              return (component.ref as any)?.onKeyDown(props) ?? false
            },
            onExit: () => {
              popup?.[0]?.destroy()
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})
