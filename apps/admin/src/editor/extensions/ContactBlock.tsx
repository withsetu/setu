import { useEffect } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Settings } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_SUCCESS_MESSAGE,
  coerceBool,
  contactPreviewFields,
  ensureFormId,
} from './contact-helpers'

function ContactView({ node, updateAttributes }: ReactNodeViewProps) {
  const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>

  // Back-compat / insert safety: persist a stable formId if missing.
  useEffect(() => {
    const id = mdAttrs.formId
    if (typeof id !== 'string' || id === '') updateAttributes({ mdAttrs: ensureFormId(mdAttrs) })
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setAttrs = (patch: Record<string, unknown>) =>
    updateAttributes({ mdAttrs: { ...mdAttrs, ...patch } })

  const formLabel = String(mdAttrs.formLabel ?? '')
  const subject = coerceBool(mdAttrs.subject, false)
  const nameRequired = coerceBool(mdAttrs.nameRequired, true)
  const subjectRequired = coerceBool(mdAttrs.subjectRequired, false)
  const successMessage = String(mdAttrs.successMessage ?? DEFAULT_SUCCESS_MESSAGE)
  const fields = contactPreviewFields(mdAttrs)

  return (
    <NodeViewWrapper>
      <div
        className="setu-contact-block rounded-lg border bg-card p-4"
        data-contact
        contentEditable={false}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Contact form{formLabel ? ` · ${formLabel}` : ''}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Form settings">
                <Settings className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cf-name">Form name</Label>
                <Input
                  id="cf-name"
                  value={formLabel}
                  placeholder="Contact"
                  onChange={(e) => setAttrs({ formLabel: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="cf-subject">Subject field</Label>
                <Switch
                  id="cf-subject"
                  checked={subject}
                  onCheckedChange={(v) => setAttrs({ subject: v })}
                />
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Required
                </span>
                <div className="flex items-center justify-between text-sm">
                  <span>Email</span>
                  <span className="text-muted-foreground">Always</span>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="cf-name-req">Name</Label>
                  <Switch
                    id="cf-name-req"
                    checked={nameRequired}
                    onCheckedChange={(v) => setAttrs({ nameRequired: v })}
                  />
                </div>
                {subject && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="cf-subject-req">Subject</Label>
                    <Switch
                      id="cf-subject-req"
                      checked={subjectRequired}
                      onCheckedChange={(v) => setAttrs({ subjectRequired: v })}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span>Message</span>
                  <span className="text-muted-foreground">Always</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cf-success">Success message</Label>
                <Input
                  id="cf-success"
                  value={successMessage}
                  onChange={(e) => setAttrs({ successMessage: e.target.value })}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Static, non-interactive preview of the rendered form. */}
        <div className="grid max-w-md gap-3">
          {fields.map((f) => (
            <div key={f.name} className="grid gap-1">
              <label className="text-sm font-medium">
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </label>
              {f.type === 'textarea' ? (
                <textarea
                  disabled
                  rows={3}
                  className="rounded-md border bg-muted/30 px-3 py-2 text-sm"
                />
              ) : (
                <input
                  disabled
                  type={f.type}
                  className="rounded-md border bg-muted/30 px-3 py-2 text-sm"
                />
              )}
            </div>
          ))}
          <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Spam protection (Cloudflare Turnstile)
          </div>
          <button
            type="button"
            disabled
            className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground opacity-70"
          >
            Send
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

/** Dedicated editor node for the `{% contact %}` block. Content-less (atom) —
 *  the form has no author-editable body. `mdAttrs` is the block's Markdoc
 *  attribute bag (kept out of the DOM), round-tripped by the converters. */
export const ContactBlock = Node.create({
  name: 'contactBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      mdAttrs: {
        default: {},
        renderHTML: () => ({}),
        parseHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-contact]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-contact': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ContactView)
  },
})
