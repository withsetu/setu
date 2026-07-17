# Synthetic AIC-shaped fixtures

Every record in `artworks/` is **synthetic** — invented titles, artists, and
descriptions authored for these tests. No real Art Institute of Chicago records
(or any third-party content) are committed to this repo; that keeps the
"repo ships no third-party content" licensing rule airtight (epic #509).

The field shapes mirror the real dump files (`artic-api-data/json/artworks/{id}.json`,
bare artwork records — verified 2026-07-16 against the nightly dump tarball and
`https://api.artic.edu/api/v1/artworks/{id}`). Coverage by file:

| file       | purpose                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `101.json` | fully-populated public-domain record → post                              |
| `102.json` | minimal optional fields; date falls back to `source_updated_at` → post   |
| `103.json` | `is_public_domain: false` → skipped (`notPublicDomain`)                  |
| `104.json` | `image_id: null` → skipped (`noImage`)                                   |
| `105.json` | empty `description` → skipped (`noText`)                                 |
| `106.json` | missing `title` → skipped (`invalid`, zod)                               |
| `107.json` | not JSON at all → skipped (`invalid`, parse error)                       |
| `108.json` | HTML-rich description (em/strong/link/list), BCE date → post             |
| `109.json` | no date fields anywhere → skipped (`noDate`)                             |
| `110.json` | ancient year (`date_end: 79`) — must map to 0079, not 1979 → post        |
| `111.json` | `short_description` only → skipped (`noText`) strict; → post relaxed tier |
