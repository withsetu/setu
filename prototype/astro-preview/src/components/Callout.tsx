interface Props {
  type?: 'info' | 'warning'
  text: string
}

// A real React component — same one that could hydrate on the live site.
export default function Callout({ type = 'info', text }: Props) {
  return (
    <aside className={`callout callout--${type}`} data-component="Callout.tsx">
      <span aria-hidden>💡</span> {text}
    </aside>
  )
}
