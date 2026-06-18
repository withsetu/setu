// This schema uses only drizzle-orm/sqlite-core primitives. It is intentionally
// dialect-agnostic so that @setu/db-d1 can import it unchanged.
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'

export const drafts = sqliteTable(
  'drafts',
  {
    collection: text('collection').notNull(),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    content: text('content').notNull(), // JSON (TiptapDoc)
    metadata: text('metadata').notNull(), // JSON
    baseSha: text('base_sha'), // nullable
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(), // epoch ms
  },
  (t) => [primaryKey({ columns: [t.collection, t.locale, t.slug] })],
)

export const locks = sqliteTable(
  'locks',
  {
    collection: text('collection').notNull(),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    lockedBy: text('locked_by').notNull(),
    lockedAt: integer('locked_at').notNull(), // epoch ms
  },
  (t) => [primaryKey({ columns: [t.collection, t.locale, t.slug] })],
)
