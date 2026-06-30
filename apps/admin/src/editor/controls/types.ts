export interface ControlMeta {
  name: string
  options?: string[]
  default?: unknown
  apiBase: string
  /** Open the media library for this control's prop name. */
  onPickMedia: (name: string) => void
}

export interface ControlProps {
  value: unknown
  onChange: (next: unknown) => void
  meta: ControlMeta
}
