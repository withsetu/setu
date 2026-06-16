import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'
import { LinkPopup } from '../LinkPopup'

export const linkToolsKey = new PluginKey('saytuLinkTools')

interface LinkToolsOptions {
  /** Called when the user picks Edit — select the link range so the format bubble opens. */
  onEdit?: (editor: Editor, href: string) => void
}

/** Shows the LinkPopup card when the caret is inside a link OR the mouse hovers a
 *  link. Reuses the tippy + ReactRenderer pattern (as BlockMenu/DragHandle do). */
export const LinkTools = Extension.create<LinkToolsOptions>({
  name: 'saytuLinkTools',
  addOptions() {
    return { onEdit: undefined }
  },
  addProseMirrorPlugins() {
    const options = this.options
    const editor = this.editor
    let popup: TippyInstance | null = null
    let renderer: ReactRenderer | null = null
    let shownFor: HTMLElement | null = null

    const hide = () => {
      popup?.destroy()
      popup = null
      renderer?.destroy()
      renderer = null
      shownFor = null
    }

    const showFor = (anchor: HTMLElement, href: string) => {
      if (shownFor === anchor && popup) return
      hide()
      shownFor = anchor
      renderer = new ReactRenderer(LinkPopup, {
        editor,
        props: {
          href,
          editable: editor.isEditable,
          onEdit: () => {
            hide()
            options.onEdit?.(editor, href)
          },
          onRemove: () => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            hide()
          },
        },
      })
      popup = tippy(document.body, {
        getReferenceClientRect: () => anchor.getBoundingClientRect(),
        appendTo: () => document.body,
        content: renderer.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'top',
      })
    }

    return [
      new Plugin({
        key: linkToolsKey,
        props: {
          handleDOMEvents: {
            mouseover(_view, event) {
              const target = event.target as HTMLElement | null
              const a = target?.closest('a')
              if (a instanceof HTMLAnchorElement) {
                const href = a.getAttribute('href') ?? a.href
                if (href) showFor(a, href)
              }
              return false
            },
          },
        },
        view() {
          return {
            update() {
              const { state } = editor
              if (!state.selection.empty || !editor.isActive('link')) return
              const href = (editor.getAttributes('link').href as string | undefined) ?? ''
              if (!href) return
              const domAt = editor.view.domAtPos(state.selection.from)
              const node = domAt.node
              const el = node instanceof HTMLElement ? node : node.parentElement
              const a = el?.closest('a')
              if (a instanceof HTMLAnchorElement) showFor(a, href)
            },
          }
        },
      }),
    ]
  },
})
