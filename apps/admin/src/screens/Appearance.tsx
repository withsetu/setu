import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { themeOptions, resolveThemeTokens } from '@setu/theme-default/options'
import type { ThemeOption } from '@setu/theme-default/options'
import { Callout } from '@setu/blocks'
import { PageHeader } from '../shell/PageHeader'

const STORAGE_KEY = 'setu-theme-options'

function defaults(): Record<string, string> {
  return Object.fromEntries(themeOptions.map((o) => [o.key, o.default]))
}

function loadValues(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Record<string, string>) }
  } catch {
    // ignore (private mode / corrupt) — fall back to defaults
  }
  return defaults()
}

/** A hex color is valid if it matches #rgb/#rgba/#rrggbb/#rrggbbaa. */
const isHex = (v: string) => /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)

export function Appearance() {
  const [values, setValues] = useState<Record<string, string>>(loadValues)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(values))
    } catch {
      // ignore
    }
  }, [values])

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }))
  const resetKey = (key: string, def: string) => set(key, def)
  const resetAll = () => setValues(defaults())

  // resolveThemeTokens returns { '--accent': '…', … } — apply as inline custom properties so the
  // preview subtree restyles exactly as the published site would (same resolver).
  const previewStyle = resolveThemeTokens(values) as CSSProperties

  return (
    <>
      <PageHeader
        title="Appearance"
        subtitle="Customize how your site looks. Changes preview live and are remembered."
        actions={
          <button type="button" className="btn btn-ghost btn-md" onClick={resetAll}>
            Reset all
          </button>
        }
      />
      <div className="page-body">
        <div className="customize">
          <div className="cz-controls" role="group" aria-label="Theme options">
            {themeOptions.map((opt) => (
              <Control
                key={opt.key}
                opt={opt}
                value={values[opt.key] ?? opt.default}
                onChange={(v) => set(opt.key, v)}
                onReset={() => resetKey(opt.key, opt.default)}
              />
            ))}
          </div>
          <div className="cz-preview">
            <div className="cz-preview-card" style={previewStyle} data-testid="cz-preview">
              <h2 className="cz-h">The quick brown fox</h2>
              <p className="cz-p">
                Jumps over the lazy dog. This is how your body copy reads — the font, size and
                rhythm of everyday paragraphs on your site.
              </p>
              <button type="button" className="cz-btn" tabIndex={-1}>
                Primary button
              </button>
              <Callout
                tone="accent"
                icon="info"
                title={<span className="callout-title-static">Pro tip</span>}
              >
                <div className="callout-body">
                  <p>Callouts pick up your accent and corner style too.</p>
                </div>
              </Callout>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function Control({
  opt,
  value,
  onChange,
  onReset,
}: {
  opt: ThemeOption
  value: string
  onChange: (v: string) => void
  onReset: () => void
}) {
  const isDefault = value === opt.default
  return (
    <div className="cz-field">
      <div className="cz-field-head">
        <label className="cz-label" htmlFor={`cz-${opt.key}`}>
          {opt.label}
        </label>
        {!isDefault && (
          <button type="button" className="cz-reset" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
      {opt.type === 'color' ? (
        <ColorControl id={`cz-${opt.key}`} value={value} onChange={onChange} />
      ) : (
        <SelectControl id={`cz-${opt.key}`} opt={opt} value={value} onChange={onChange} />
      )}
    </div>
  )
}

function ColorControl({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  // Local draft so the user can type a partial hex freely; commit only when it parses.
  const [text, setText] = useState(value)
  useEffect(() => {
    setText(value)
  }, [value])
  return (
    <div className="cz-color">
      <input
        id={id}
        type="color"
        className="cz-swatch"
        value={isHex(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Color picker"
      />
      <input
        type="text"
        className="cz-hex"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          if (isHex(e.target.value)) onChange(e.target.value)
        }}
        aria-label="Hex value"
      />
    </div>
  )
}

function SelectControl({
  id,
  opt,
  value,
  onChange,
}: {
  id: string
  opt: ThemeOption
  value: string
  onChange: (v: string) => void
}) {
  const choices = opt.choices ?? []
  // Segmented control for a small choice set; a dropdown once it gets long (e.g. Font).
  if (choices.length <= 4) {
    return (
      <div className="cz-segmented" role="group" aria-labelledby={`${id}`}>
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`cz-seg${c.value === value ? ' on' : ''}`}
            aria-pressed={c.value === value}
            onClick={() => onChange(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    )
  }
  return (
    <select id={id} className="cz-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  )
}
