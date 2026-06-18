import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { isEscape } from '../dismiss'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'
import { LinkPopup } from '../LinkPopup'

export const linkToolsKey = new PluginKey('setuLinkTools')

/** Whether the caret-triggered link card should show for this state. Pure.
 *  `dismissed` is true while the user has Esc-dismissed the card for the link the
 *  caret currently sits in (suppresses re-show until the caret leaves that link). */
export function shouldShowLinkCard(
  selectionEmpty: boolean,
  linkActive: boolean,
  href: string,
  dismissed = false,
): boolean {
  return selectionEmpty && linkActive && href.length > 0 && !dismissed
}

interface LinkToolsOptions {
  /** Called when the user picks Edit — select the link range so the format bubble opens. */
  onEdit?: (editor: Editor, href: string) => void
}

/** Shows the LinkPopup card when the caret is inside a link OR the mouse hovers a
 *  link. Reuses the tippy + ReactRenderer pattern (as BlockMenu/DragHandle do). */
export const LinkTools = Extension.create<LinkToolsOptions>({
  name: 'setuLinkTools',
  addOptions() {
    return { onEdit: undefined }
  },
  addProseMirrorPlugins() {
    const options = this.options
    const editor = this.editor
    let popup: TippyInstance | null = null
    let renderer: ReactRenderer | null = null
    let shownFor: HTMLElement | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    let dismissedHref: string | null = null

    const cancelHide = () => {
      if (hideTimer !== null) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
    }

    const hide = () => {
      cancelHide()
      popup?.destroy()
      popup = null
      renderer?.destroy()
      renderer = null
      shownFor = null
    }

    /** Hide after a short grace period — but NOT while the caret pins the card
     *  (clicked into a link) or the pointer is over the card. The delay lets the
     *  pointer cross the gap from the link to the card without it vanishing. */
    const scheduleHide = () => {
      cancelHide()
      hideTimer = setTimeout(() => {
        hideTimer = null
        if (editor.state.selection.empty && editor.isActive('link')) return
        if (popup && popup.popper.matches(':hover')) return
        hide()
      }, 180)
    }

    const showFor = (anchor: HTMLElement, href: string) => {
      if (dismissedHref !== null && href === dismissedHref) return
      cancelHide()
      if (shownFor === anchor && popup) return
      hide()
      shownFor = anchor
      renderer = new ReactRenderer(LinkPopup, {
        editor,
        props: {
          href,
          editable: editor.isEditable,
          onEdit: () => {
            // Target THIS link (the card may have been shown by hover, with the caret
            // elsewhere): place the caret inside the anchor's link before editing.
            const pos = editor.view.posAtDOM(anchor, 0)
            editor.chain().focus().setTextSelection(pos).run()
            hide()
            options.onEdit?.(editor, href)
          },
          onRemove: () => {
            const pos = editor.view.posAtDOM(anchor, 0)
            editor.chain().focus().setTextSelection(pos).extendMarkRange('link').unsetLink().run()
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
      // Keep the card alive while the pointer is over it (so its buttons are clickable).
      popup.popper.addEventListener('mouseenter', cancelHide)
      popup.popper.addEventListener('mouseleave', scheduleHide)
    }

    return [
      new Plugin({
        key: linkToolsKey,
        props: {
          handleKeyDown(_view, event) {
            if (isEscape(event) && popup) {
              dismissedHref = (editor.getAttributes('link').href as string | undefined) ?? ''
              hide()
              return true
            }
            return false
          },
          handleDOMEvents: {
            mouseover(_view, event) {
              const a = (event.target as HTMLElement | null)?.closest('a')
              if (a instanceof HTMLAnchorElement) {
                const href = a.getAttribute('href') ?? ''
                if (href) showFor(a, href)
              }
              return false
            },
            mouseout(_view, event) {
              if (popup === null) return false
              const to = event.relatedTarget as Node | null
              if (to instanceof HTMLElement && to.closest('a')) return false // onto a link
              if (to && popup.popper.contains(to)) return false // onto the card
              scheduleHide() // grace period; the timer re-checks caret/hover before hiding
              return false
            },
            click(_view, event) {
              // Links never navigate from inside the editor (Tiptap's openOnClick is
              // unreliable — issue #6865). Clicking places the caret + shows the card;
              // the card's "Open ↗" is the deliberate way to follow the link.
              if ((event.target as HTMLElement | null)?.closest('a')) event.preventDefault()
              return false
            },
          },
        },
        view() {
          return {
            update() {
              const { state } = editor
              const href = (editor.getAttributes('link').href as string | undefined) ?? ''
              const inSameDismissedLink =
                dismissedHref !== null &&
                editor.isActive('link') &&
                state.selection.empty &&
                href === dismissedHref
              if (dismissedHref !== null && !inSameDismissedLink) dismissedHref = null // caret left → re-arm
              if (shouldShowLinkCard(state.selection.empty, editor.isActive('link'), href, inSameDismissedLink)) {
                const domAt = editor.view.domAtPos(state.selection.from)
                const node = domAt.node
                const el = node instanceof HTMLElement ? node : node.parentElement
                const a = el?.closest('a')
                if (a instanceof HTMLAnchorElement) showFor(a, href)
              } else if (popup && !popup.popper.matches(':hover')) {
                // caret left the link; hide unless the pointer is on the card
                scheduleHide()
              }
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
