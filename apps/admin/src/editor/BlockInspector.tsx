import { useState } from 'react'
import { resolveControls } from '@setu/core'
import { registry } from '../blocks/registry'
import { Label } from '@/components/ui/label'
import { MediaPickerModal } from './MediaPickerModal'
import { controlRegistry } from './controls/registry'

export function BlockInspector({
  tag, mdAttrs, onChange, apiBase,
}: { tag: string; mdAttrs: Record<string, unknown>; onChange: (name: string, value: unknown) => void; apiBase: string }) {
  const block = registry.blocks.find((b) => b.tag === tag)
  const [pickFor, setPickFor] = useState<string | null>(null)
  if (!block) return <p className="px-1 py-2 text-sm text-muted-foreground">No editable properties.</p>

  const controls = resolveControls(block.props, block.editor?.controls)
  const showWhen = block.editor?.showWhen ?? {}
  const visible = controls.filter((c) => {
    const rule = showWhen[c.name]
    if (!rule) return true
    return Object.entries(rule).every(([k, v]) => {
      const cur = mdAttrs[k]
      return Array.isArray(v) ? v.includes(cur as string) : cur === v
    })
  })

  return (
    <div className="flex flex-col gap-3">
      {visible.map((c) => {
        const Control = controlRegistry[c.control]
        return (
          <div key={c.name} className="flex flex-col gap-1.5">
            <Label htmlFor={`bi-${c.name}`} className="capitalize">{c.name}</Label>
            <Control
              value={mdAttrs[c.name] ?? c.default}
              onChange={(v) => onChange(c.name, v)}
              meta={{ name: c.name, options: c.options, default: c.default, apiBase, onPickMedia: setPickFor }}
            />
          </div>
        )
      })}
      <MediaPickerModal apiBase={apiBase} open={pickFor !== null} onClose={() => setPickFor(null)}
        onPick={(src) => { if (pickFor) onChange(pickFor, src); setPickFor(null) }} />
    </div>
  )
}
