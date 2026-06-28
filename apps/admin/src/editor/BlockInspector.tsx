import { useState } from 'react'
import { resolveControls } from '@setu/core'
import { registry } from '../blocks/registry'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { MediaPickerModal } from './MediaPickerModal'
import { resolveMediaSrc } from './media-src'

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
  const val = (name: string, dflt?: unknown) => mdAttrs[name] ?? dflt ?? ''

  return (
    <div className="flex flex-col gap-3">
      {visible.map((c) => (
        <div key={c.name} className="flex flex-col gap-1.5">
          <Label htmlFor={`bi-${c.name}`} className="capitalize">{c.name}</Label>
          {c.control === 'textarea' ? (
            <Textarea id={`bi-${c.name}`} aria-label={c.name} value={String(val(c.name, c.default))} onChange={(e) => onChange(c.name, e.target.value)} />
          ) : c.control === 'number' ? (
            <Input id={`bi-${c.name}`} aria-label={c.name} type="number" value={String(val(c.name, c.default))} onChange={(e) => onChange(c.name, e.target.value === '' ? '' : Number(e.target.value))} />
          ) : c.control === 'switch' ? (
            <Switch id={`bi-${c.name}`} aria-label={c.name} checked={Boolean(mdAttrs[c.name] ?? c.default ?? false)} onCheckedChange={(v) => onChange(c.name, v)} />
          ) : c.control === 'select' ? (
            <Select value={String(val(c.name, c.default))} onValueChange={(v) => onChange(c.name, v)}>
              <SelectTrigger id={`bi-${c.name}`} aria-label={c.name}><SelectValue /></SelectTrigger>
              <SelectContent>
                {(c.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : c.control === 'media' ? (
            <div className="flex items-center gap-2">
              {mdAttrs[c.name] ? <img src={resolveMediaSrc(String(mdAttrs[c.name]), apiBase || undefined)} alt="" className="size-12 rounded object-cover" /> : null}
              <Button type="button" variant="outline" size="sm" aria-label={c.name} onClick={() => setPickFor(c.name)}>
                {mdAttrs[c.name] ? 'Replace' : 'Choose'}
              </Button>
            </div>
          ) : c.control === 'color' ? (
            <div className="flex items-center gap-2">
              <input type="color" aria-label={c.name}
                value={(String(mdAttrs[c.name] ?? '#000000ff')).slice(0, 7)}
                onChange={(e) => onChange(c.name, e.target.value + (String(mdAttrs[c.name] ?? '').slice(7) || 'ff'))}
                className="h-8 w-10 rounded border border-border bg-transparent p-0.5" />
              <input type="range" min={0} max={100} aria-label={`${c.name} opacity`}
                value={Math.round((parseInt((String(mdAttrs[c.name] ?? '#000000ff')).slice(7) || 'ff', 16) / 255) * 100)}
                onChange={(e) => {
                  const a = Math.round((Number(e.target.value) / 100) * 255).toString(16).padStart(2, '0')
                  onChange(c.name, (String(mdAttrs[c.name] ?? '#000000ff')).slice(0, 7) + a)
                }}
                className="flex-1" />
            </div>
          ) : (
            <Input id={`bi-${c.name}`} aria-label={c.name} type={c.control === 'url' ? 'url' : 'text'} value={String(val(c.name))} onChange={(e) => onChange(c.name, e.target.value)} />
          )}
        </div>
      ))}
      <MediaPickerModal apiBase={apiBase} open={pickFor !== null} onClose={() => setPickFor(null)}
        onPick={(src) => { if (pickFor) onChange(pickFor, src); setPickFor(null) }} />
    </div>
  )
}
