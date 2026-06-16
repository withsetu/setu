import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'
import { LinkPopup } from '../LinkPopup'

export const linkToolsKey = new PluginKey('saytuLinkTools')

/** Whether the caret-triggered link card should show for this state. Pure. */
export function shouldShowLinkCard(selectionEmpty: boolean, linkActive: boolean, href: string): boolean {
  return selectionEmpty && linkActive && href.length > 0
}

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
    let mode: 'caret' | 'hover' | null = null

    const hide = () => {
      popup?.destroy()
      popup = null
      renderer?.destroy()
      renderer = null
      shownFor = null
      mode = null
    }

    const showFor = (anchor: HTMLElement, href: string, m: 'caret' | 'hover') => {
      if (shownFor === anchor && popup) {
        mode = m
        return
      }
      hide()
      shownFor = anchor
      mode = m
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
              const a = (event.target as HTMLElement | null)?.closest('a')
              if (a instanceof HTMLAnchorElement) {
                const href = a.getAttribute('href') ?? ''
                if (href) showFor(a, href, 'hover')
              }
              return false
            },
            mouseout(_view, event) {
              if (mode !== 'hover') return false
              const to = event.relatedTarget as Node | null
              if (to instanceof HTMLElement && to.closest('a')) return false
              if (popup && to && popup.popper.contains(to)) return false
              hide()
              return false
            },
          },
        },
        view() {
          return {
            update() {
              const { state } = editor
              const href = (editor.getAttributes('link').href as string | undefined) ?? ''
              if (!shouldShowLinkCard(state.selection.empty, editor.isActive('link'), href)) {
                if (mode === 'caret') hide()
                return
              }
              const domAt = editor.view.domAtPos(state.selection.from)
              const node = domAt.node
              const el = node instanceof HTMLElement ? node : node.parentElement
              const a = el?.closest('a')
              if (a instanceof HTMLAnchorElement) showFor(a, href, 'caret')
            },
            destroy() {
              hide()
            },
          }
        },
      }),
    ]
  },
})
