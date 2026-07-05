import { Icon } from '../ui/Icon'

/** The link card: open the link in a new tab, or (when editable) edit / remove it. */
export function LinkPopup({
  href,
  onEdit,
  onRemove,
  editable
}: {
  href: string
  onEdit: () => void
  onRemove: () => void
  editable: boolean
}) {
  return (
    <div className="link-card" role="group" aria-label="Link">
      <a
        className="link-card-open"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open link in new tab"
      >
        <Icon name="external" size={14} />
        <span className="link-card-url">{href}</span>
      </a>
      {editable && (
        <>
          <button
            type="button"
            className="link-card-btn"
            aria-label="Edit link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onEdit}
          >
            <Icon name="edit" size={14} />
          </button>
          <button
            type="button"
            className="link-card-btn"
            aria-label="Remove link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onRemove}
          >
            <Icon name="trash" size={14} />
          </button>
        </>
      )}
    </div>
  )
}
