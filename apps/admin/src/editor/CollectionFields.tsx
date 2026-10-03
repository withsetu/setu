import { useState } from 'react'
import type { ResolvedControl } from '@setu/core'
import { Label } from '@/components/ui/label'
import { controlRegistry } from './controls/registry'
import { humanizeLabel } from './humanize-label'
import { MediaPickerModal } from './MediaPickerModal'

/** DOM id prefix for these controls — distinct from the block inspector's `bi`, because both
 *  panels are on screen together and may render a control for the same field name. */
const ID_PREFIX = 'cf'

/**
 * The entry form for a collection's DECLARED fields (#963), generated from the schema
 * `/api/collections` serves (#1125).
 *
 * Before this, a collection could declare required fields, the write path would enforce them, and
 * the admin rendered a control for none — so an editor creating a product got a 422 naming seven
 * fields they had no way to fill in (measured in the #962 spike). Declaring a field made a
 * collection LESS editable than declaring nothing.
 *
 * Controls come from the same `controlRegistry` the block inspector renders, so an enum is a
 * picker and a boolean is a switch without any control code being written twice.
 *
 * Three states, kept apart on purpose (§4 #22): fields → the form; `fieldsError` → an alert
 * saying the schema could not be read; neither → nothing at all. Rendering "no fields" over a
 * schema that failed to load is the #837 shape.
 */
export function CollectionFields({
  fields,
  fieldsError,
  metadata,
  editable,
  apiBase,
  onChange
}: {
  fields?: ResolvedControl[]
  /** Set when the server could describe the collection but not its schema. */
  fieldsError?: string
  metadata: Record<string, unknown>
  editable: boolean
  apiBase: string
  onChange: (next: Record<string, unknown>) => void
}) {
  const [pickFor, setPickFor] = useState<{
    name: string
    kind: 'image' | 'video'
  } | null>(null)

  if (fieldsError) {
    return (
      <p role="alert" className="text-[13px] text-destructive">
        These fields could not be read from the site config, so they are not
        editable here: {fieldsError}
      </p>
    )
  }
  if (!fields || fields.length === 0) return null

  const set = (name: string, value: unknown) => {
    // Spread the full map so frontmatter this form does not manage round-trips untouched —
    // the same data-honesty rule MetaPanel's other sections follow.
    const next = { ...metadata }
    if (value === undefined || value === '') delete next[name]
    else next[name] = value
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {fields.map((f) => {
        const Control = controlRegistry[f.control]
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <Label
              id={`${ID_PREFIX}-label-${f.name}`}
              htmlFor={`${ID_PREFIX}-${f.name}`}
            >
              {humanizeLabel(f.name)}
              {f.required && (
                <span aria-hidden="true" className="ml-0.5 text-destructive">
                  *
                </span>
              )}
              {f.required && <span className="sr-only"> (required)</span>}
            </Label>
            <Control
              value={metadata[f.name] ?? f.default}
              onChange={(v) => set(f.name, v)}
              meta={{
                name: f.name,
                options: f.options,
                default: f.default,
                min: f.min,
                max: f.max,
                step: f.step,
                apiBase,
                idPrefix: ID_PREFIX,
                disabled: !editable,
                onPickMedia: (name) =>
                  setPickFor({
                    name,
                    kind: f.control === 'video' ? 'video' : 'image'
                  })
              }}
            />
          </div>
        )
      })}
      <MediaPickerModal
        apiBase={apiBase}
        kind={pickFor?.kind ?? 'image'}
        open={pickFor !== null}
        onClose={() => setPickFor(null)}
        onPick={(src) => {
          if (pickFor) set(pickFor.name, src)
          setPickFor(null)
        }}
      />
    </div>
  )
}
