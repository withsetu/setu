import { useState, Fragment } from 'react'
import { resolveControls } from '@setu/core'
import type { ResolvedControl } from '@setu/core'
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

  // Build a map of name → visible control for fast lookup
  const visibleByName = new Map(visible.map((c) => [c.name, c]))

  // Compute groups: use declared groups if present, otherwise a single implicit group
  const declaredGroups = block.editor?.groups
  let groups: Array<{ label: string; controls: ResolvedControl[] }>

  if (declaredGroups && declaredGroups.length > 0) {
    // Track which visible controls have been assigned to a declared group
    const assigned = new Set<string>()
    const resolved = declaredGroups.map((g) => {
      const gControls = g.controls.flatMap((name) => {
        const c = visibleByName.get(name)
        if (c) { assigned.add(name); return [c] }
        return []
      })
      return { label: g.label, controls: gControls }
    })
    // Orphan handling: visible controls not in any declared group go into the first group
    const orphans = visible.filter((c) => !assigned.has(c.name))
    if (orphans.length > 0 && resolved.length > 0) {
      const first = resolved[0]!
      resolved[0] = { label: first.label, controls: [...orphans, ...first.controls] }
    }
    groups = resolved
  } else {
    // No declared groups — single implicit group with no label (flat rendering)
    groups = [{ label: '', controls: visible }]
  }

  function renderControl(c: ResolvedControl) {
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
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        if (g.controls.length === 0) return null
        return g.label ? (
          <section key={g.label} className="flex flex-col gap-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {g.label}
            </h3>
            {g.controls.map(renderControl)}
          </section>
        ) : (
          <Fragment key="__ungrouped">{g.controls.map(renderControl)}</Fragment>
        )
      })}
      <MediaPickerModal apiBase={apiBase} open={pickFor !== null} onClose={() => setPickFor(null)}
        onPick={(src) => { if (pickFor) onChange(pickFor, src); setPickFor(null) }} />
    </div>
  )
}
