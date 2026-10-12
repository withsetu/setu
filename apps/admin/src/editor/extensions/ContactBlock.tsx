import { useEffect, useId } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { Settings } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { CONTACT_DEFAULT_TEXT, type ContactText } from '@setu/core'
import {
  DEFAULT_SUCCESS_MESSAGE,
  coerceBool,
  contactPreviewFields,
  contactText,
  ensureFormId
} from './contact-helpers'
import { attrString } from '../attr-string'
import { useMirroredField } from '../useMirroredField'

/** One optional visitor-text override (#1248). Blank = the default, shown as the
 *  placeholder; clearing the field removes the attribute rather than storing ''. Mirrored
 *  like the other free-text inputs here (#691). */
function TextOverride({
  id,
  label,
  attr,
  mdAttrs,
  onCommit
}: {
  id: string
  label: string
  attr: keyof ContactText
  mdAttrs: Record<string, unknown>
  onCommit: (attr: keyof ContactText, value: string) => void
}) {
  const current = attrString(mdAttrs[attr])
  const field = useMirroredField(current, (v) => onCommit(attr, v))
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={field.value}
        placeholder={CONTACT_DEFAULT_TEXT[attr]}
        onChange={(e) => field.onChange(e.target.value)}
      />
    </div>
  )
}

function ContactView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const mdAttrs = (node.attrs.mdAttrs ?? {}) as Record<string, unknown>
  const uid = useId()

  // Back-compat / insert safety: persist a stable formId if missing.
  useEffect(() => {
    const id = mdAttrs.formId
    if (typeof id !== 'string' || id === '')
      updateAttributes({ mdAttrs: ensureFormId(mdAttrs) })
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setAttrs = (patch: Record<string, unknown>) =>
    updateAttributes({ mdAttrs: { ...mdAttrs, ...patch } })
  const setText = (attr: keyof ContactText, value: string) => {
    const next = { ...mdAttrs }
    if (value === '') delete next[attr]
    else next[attr] = value
    updateAttributes({ mdAttrs: next })
  }

  const formLabel = attrString(mdAttrs.formLabel)
  const subject = coerceBool(mdAttrs.subject, false)
  const nameRequired = coerceBool(mdAttrs.nameRequired, true)
  const subjectRequired = coerceBool(mdAttrs.subjectRequired, false)
  const successMessage = attrString(
    mdAttrs.successMessage,
    DEFAULT_SUCCESS_MESSAGE
  )
  const fields = contactPreviewFields(mdAttrs)

  // Form name and success message are free-text inputs: mirror their value in local
  // state so clearing a field right after typing is not swallowed by 3.28's deferred
  // node-view re-render (#691). (The Switches and the disabled preview fields below
  // are non-editable, so they need no mirroring.)
  const formLabelField = useMirroredField(formLabel, (v) =>
    setAttrs({ formLabel: v })
  )
  const successField = useMirroredField(successMessage, (v) =>
    setAttrs({ successMessage: v })
  )

  return (
    <NodeViewWrapper>
      <div
        className={`setu-contact-block setu-canvas-card rounded-lg border bg-card p-4${selected ? ' is-selected' : ''}`}
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
            <PopoverContent
              align="end"
              className="max-h-[min(40rem,80vh)] w-80 space-y-3 overflow-y-auto"
            >
              <div className="space-y-1">
                <Label htmlFor={`${uid}-name`}>Form name</Label>
                <Input
                  id={`${uid}-name`}
                  value={formLabelField.value}
                  placeholder="Contact"
                  onChange={(e) => formLabelField.onChange(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor={`${uid}-subject`}>Subject field</Label>
                <Switch
                  id={`${uid}-subject`}
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
                  <Label htmlFor={`${uid}-name-req`}>Name</Label>
                  <Switch
                    id={`${uid}-name-req`}
                    checked={nameRequired}
                    onCheckedChange={(v) => setAttrs({ nameRequired: v })}
                  />
                </div>
                {subject && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`${uid}-subject-req`}>Subject</Label>
                    <Switch
                      id={`${uid}-subject-req`}
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
              <div className="space-y-2 border-t pt-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Text
                </span>
                <p className="text-xs text-muted-foreground">
                  What visitors read. Leave a field blank to use the default.
                </p>
                <TextOverride
                  id={`${uid}-name-label`}
                  label="Name label"
                  attr="nameLabel"
                  mdAttrs={mdAttrs}
                  onCommit={setText}
                />
                <TextOverride
                  id={`${uid}-email-label`}
                  label="Email label"
                  attr="emailLabel"
                  mdAttrs={mdAttrs}
                  onCommit={setText}
                />
                {subject && (
                  <TextOverride
                    id={`${uid}-subject-label`}
                    label="Subject label"
                    attr="subjectLabel"
                    mdAttrs={mdAttrs}
                    onCommit={setText}
                  />
                )}
                <TextOverride
                  id={`${uid}-message-label`}
                  label="Message label"
                  attr="messageLabel"
                  mdAttrs={mdAttrs}
                  onCommit={setText}
                />
                <TextOverride
                  id={`${uid}-submit-label`}
                  label="Button text"
                  attr="submitLabel"
                  mdAttrs={mdAttrs}
                  onCommit={setText}
                />
                <div className="space-y-1">
                  <Label htmlFor={`${uid}-success`}>Success message</Label>
                  <Input
                    id={`${uid}-success`}
                    value={successField.value}
                    onChange={(e) => successField.onChange(e.target.value)}
                  />
                </div>
                <TextOverride
                  id={`${uid}-error-message`}
                  label="Error message"
                  attr="errorMessage"
                  mdAttrs={mdAttrs}
                  onCommit={setText}
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
            {contactText(mdAttrs, 'submitLabel')}
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
        parseHTML: () => ({})
      }
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
  }
})
