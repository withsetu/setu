import { useState } from 'react'
import { Editor } from './editor/Editor'

const NAV = [
  { icon: '🏠', label: 'Dashboard' },
  { icon: '📝', label: 'Content', active: true },
  { icon: '🖼️', label: 'Media' },
  { icon: '📨', label: 'Forms' },
  { icon: '🌐', label: 'Site' },
  { icon: '⚙️', label: 'Settings' },
]

function StatePill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Draft
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-800 outline-none focus:border-neutral-400'

export default function App() {
  const [saved, setSaved] = useState(true)
  const [words, setWords] = useState(0)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-50 text-neutral-900">
      {/* Left nav rail */}
      <nav
        aria-label="Primary"
        className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white"
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-sm font-bold text-white">
            S
          </div>
          <span className="font-semibold tracking-tight">Setu</span>
        </div>
        <div className="flex flex-col gap-0.5 px-2">
          {NAV.map((n) => (
            <button
              key={n.label}
              aria-current={n.active ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${
                n.active
                  ? 'bg-neutral-100 font-medium text-neutral-900'
                  : 'text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              <span aria-hidden>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </div>
        <div className="mt-auto border-t border-neutral-200 px-4 py-3 text-xs text-neutral-400">
          Topology: <span className="text-neutral-600">Local · Tunnel</span>
        </div>
      </nav>

      {/* Center column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-5 py-3">
          <button className="text-sm text-neutral-500 hover:text-neutral-800">← Posts</button>
          <span className="text-neutral-300">/</span>
          <span className="text-sm font-medium">Summer Launch</span>
          <StatePill />
          <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-500">
            🔒 you
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-neutral-400">
              {saved ? 'Autosaved ✓' : 'Saving…'}
            </span>
            <button className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
              Preview
            </button>
            <button className="rounded-md bg-neutral-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-neutral-800">
              Publish
            </button>
          </div>
        </header>

        {/* Editor canvas */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-12">
            <Editor
              onUpdate={({ words }) => {
                setWords(words)
                setSaved(false)
                setTimeout(() => setSaved(true), 600)
              }}
            />
          </div>
        </main>
      </div>

      {/* Right context panel */}
      <aside
        aria-label="Page settings"
        className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-white"
      >
        <div className="border-b border-neutral-200 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Metadata
        </div>
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <Field label="Title">
            <input className={inputCls} defaultValue="Summer Launch" />
          </Field>
          <Field label="Slug">
            <input className={inputCls} defaultValue="/summer-launch" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select className={inputCls} defaultValue="Draft">
                <option>Draft</option>
                <option>Staged</option>
                <option>Deployed</option>
              </select>
            </Field>
            <Field label="Locale">
              <select className={inputCls} defaultValue="EN">
                <option>EN</option>
                <option>FR</option>
                <option>HI</option>
              </select>
            </Field>
          </div>
          <Field label="Author">
            <input className={inputCls} defaultValue="you" />
          </Field>
          <Field label="Categories">
            <div className="flex flex-wrap gap-1.5">
              <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-700">
                Launch <button className="text-neutral-400">×</button>
              </span>
              <button className="rounded-full border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-400">
                + add
              </button>
            </div>
          </Field>
          <Field label="Featured image">
            <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-neutral-300 text-xs text-neutral-400">
              ▣ drop or pick from Media
            </div>
          </Field>
        </div>

        <div className="border-y border-neutral-200 px-5 py-3 text-sm text-neutral-700">
          ▸ SEO <span className="text-xs text-neutral-400">meta title, description…</span>
        </div>
        <div className="flex items-center justify-between px-5 py-3 text-sm text-neutral-700">
          <span>▸ Advanced</span>
          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
            raw Markdoc
          </span>
        </div>

        <div className="mt-auto border-t border-neutral-200 px-5 py-3 text-xs text-neutral-400">
          {words} words
        </div>
      </aside>
    </div>
  )
}
