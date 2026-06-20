function Tile({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="dash-tile">
      <span className="dash-tile-value">{value}</span>
      <span className="dash-tile-label">{label}</span>
    </div>
  )
}

export function CountsTiles({
  posts, pages, drafts, media,
}: { posts: number; pages: number; drafts: number; media: number | null }) {
  return (
    <div className="dash-tiles">
      <Tile value={posts} label="Posts" />
      <Tile value={pages} label="Pages" />
      <Tile value={drafts} label="Drafts" />
      <Tile value={media ?? '—'} label="Media" />
    </div>
  )
}
