// This schema uses only drizzle-orm/sqlite-core primitives. It is intentionally
// dialect-agnostic so that @setu/db-d1 can import it unchanged.
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'

export const submissions = sqliteTable('submissions', {
  id: text('id').primaryKey(),
  formId: text('form_id').notNull(),
  formLabel: text('form_label'), // nullable
  fields: text('fields').notNull(), // JSON
  createdAt: integer('created_at').notNull(), // epoch ms
  read: integer('read').notNull(), // 0/1
  sourceUrl: text('source_url'),
  sourceReferrer: text('source_referrer'),
  sourceUserAgent: text('source_user_agent')
})

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
    updatedAt: integer('updated_at').notNull() // epoch ms
  },
  (t) => [primaryKey({ columns: [t.collection, t.locale, t.slug] })]
)

export const locks = sqliteTable(
  'locks',
  {
    collection: text('collection').notNull(),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    lockedBy: text('locked_by').notNull(),
    lockedAt: integer('locked_at').notNull() // epoch ms
  },
  (t) => [primaryKey({ columns: [t.collection, t.locale, t.slug] })]
)

// Better Auth tables (#248). Columns reconciled against `npx @better-auth/cli
// generate` for the pinned better-auth version (1.6.23) with the drizzle
// adapter + admin plugin. better-auth writes JS `Date` objects for its
// timestamp fields, so those columns use `{ mode: 'timestamp_ms' }` rather
// than the plain-epoch-integer style used elsewhere in this file — plain
// integer columns reject Date values at the driver layer.
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .notNull()
    .default(false),
  image: text('image'),
  // Added by the admin plugin. Setu staff roles: admin|maintainer|editor|author.
  role: text('role').notNull().default('author'),
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  // Added by the admin plugin (impersonation support).
  impersonatedBy: text('impersonated_by'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', {
    mode: 'timestamp_ms'
  }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', {
    mode: 'timestamp_ms'
  }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

// Server-side content/media index (#464). Deliberate v1: each row is stored as
// an opaque JSON blob keyed by its identity, and the adapters load-all + delegate
// to the same shared pure helpers db-idb uses — contract semantics match by
// construction. Rows are tiny (no bodies); SQL-native querying/FTS5 is deferred
// to #205.
export const entryIndex = sqliteTable('entry_index', {
  key: text('key').primaryKey(), // '<collection>\0<locale>\0<slug>'
  row: text('row').notNull() // JSON (EntryIndexRow)
})

export const mediaIndex = sqliteTable('media_index', {
  mediaKey: text('media_key').primaryKey(), // '2026/06/cat'
  row: text('row').notNull() // JSON (MediaIndexRow)
})

// One meta row per index ('entry' | 'media') — IndexMeta / MediaIndexMeta as JSON.
export const indexMeta = sqliteTable('index_meta', {
  scope: text('scope').primaryKey(),
  meta: text('meta').notNull() // JSON
})

export const rateLimit = sqliteTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull()
})
