import { z } from 'zod'

/** Raw AIC artwork record — the boundary schema for dump files and API records.
 *
 *  Field shapes verified 2026-07-16 against BOTH sources (CLAUDE.md card #9):
 *  - the public API: https://api.artic.edu/api/v1/artworks/27992 (record under
 *    `data`, licensing under `info.license_text`);
 *  - a per-artwork file (`artic-api-data/json/artworks/27992.json`) from the
 *    nightly dump tarball
 *    https://artic-api-data.s3.amazonaws.com/artic-api-data.tar.bz2 — dump files
 *    are BARE artwork records (no `{data}` wrapper, no per-file `info` block);
 *    134,078 artwork files, ~1 GB extracted (artworks endpoint alone).
 *
 *  Tolerant by design: only the fields the pack consumes are declared, everything
 *  else passes through; a record failing this schema is skipped and counted,
 *  never a crash.
 */
export const rawArtworkSchema = z
  .object({
    id: z.number().int(),
    title: z.string().min(1),
    is_public_domain: z.boolean(),
    image_id: z.string().min(1).nullish(),
    description: z.string().nullish(),
    short_description: z.string().nullish(),
    artist_display: z.string().nullish(),
    artist_title: z.string().nullish(),
    date_display: z.string().nullish(),
    date_start: z.number().int().nullish(),
    date_end: z.number().int().nullish(),
    medium_display: z.string().nullish(),
    dimensions: z.string().nullish(),
    credit_line: z.string().nullish(),
    place_of_origin: z.string().nullish(),
    department_title: z.string().nullish(),
    classification_title: z.string().nullish(),
    classification_titles: z.array(z.string()).nullish(),
    term_titles: z.array(z.string()).nullish(),
    material_titles: z.array(z.string()).nullish(),
    thumbnail: z
      .object({
        width: z.number().nullish(),
        height: z.number().nullish(),
        alt_text: z.string().nullish()
      })
      .passthrough()
      .nullish(),
    updated_at: z.string().nullish(),
    source_updated_at: z.string().nullish()
  })
  .passthrough()

export type RawArtwork = z.infer<typeof rawArtworkSchema>
