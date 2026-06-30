import type { ControlProps } from './types'

export function ColorControl({ value, onChange, meta }: ControlProps) {
  const hex = String(value ?? '#000000ff')
  const alphaPct = Math.round((parseInt(hex.slice(7) || 'ff', 16) / 255) * 100)
  return (
    <div className="flex items-center gap-2">
      <input type="color" aria-label={meta.name} value={hex.slice(0, 7)}
        onChange={(e) => onChange(e.target.value + (hex.slice(7) || 'ff'))}
        className="h-8 w-10 rounded border border-border bg-transparent p-0.5" />
      <input type="range" min={0} max={100} aria-label={`${meta.name} opacity`} value={alphaPct}
        onChange={(e) => {
          const a = Math.round((Number(e.target.value) / 100) * 255).toString(16).padStart(2, '0')
          onChange(hex.slice(0, 7) + a)
        }}
        className="flex-1" />
    </div>
  )
}
