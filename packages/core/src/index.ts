export { SETU_VERSION, GENERATOR_URL } from './version'
export type {
  TiptapMark,
  TiptapNode,
  TiptapDoc,
  RoundtripOptions
} from './markdoc/types'
export { markdocToTiptap } from './markdoc/to-tiptap'
export { tiptapToMarkdoc } from './markdoc/to-markdoc'

export type {
  SetuConfig,
  BlockDefinition,
  BlockEditorMeta,
  ResolvedConfig,
  ResolvedBlock
} from './config/types'
export { defineConfig } from './config/define-config'
export { resolveConfig } from './config/resolve'
export { defaultConfig, defaultKnownBlockTags } from './config/default-config'

export type {
  SiteSettings,
  GeneralSettings,
  ReadingSettings,
  MediaSettings,
  IdentitySettings
} from './settings/types'
export {
  PERMALINK_TOKENS,
  DEFAULT_PERMALINK_PATTERN,
  validatePermalinkPattern,
  permalinkPatternSchema
} from './permalinks/pattern'
export {
  resolvePermalink,
  type PermalinkRef,
  type PermalinkOptions,
  type ResolvedPermalink
} from './permalinks/resolve'
export {
  resolvePermalinkMap,
  type PermalinkEntry,
  type PermalinkMapResult
} from './permalinks/resolve-map'
export {
  resolvePermalinkConfig,
  type PermalinksSettings,
  type ResolvedPermalinkConfig
} from './permalinks/config'
export { parseFrontmatterDate } from './permalinks/frontmatter-date'
export { DEFAULT_SETTINGS } from './settings/defaults'
export { parseSettings } from './settings/schema'

export type {
  EntryRef,
  Draft,
  DraftInput,
  DraftFilter,
  Lock
} from './data/types'
export type { DataPort } from './data/data-port'

export type {
  Submission,
  SubmissionInput,
  SubmissionFilter,
  FormSummary
} from './submissions/types'
export type { SubmissionPort } from './submissions/submission-port'
export { selectDistinctForms } from './submissions/distinct-forms'
export { createSubmissionService } from './submissions/submission-service'
export type {
  SubmissionService,
  SubmissionServiceDeps,
  SubmitInput,
  SubmitResult,
  NotificationContent
} from './submissions/submission-service'
export {
  validateContactFields,
  submitContact
} from './submissions/contact-form'
export type { ContactRequired } from './submissions/contact-form'
export { submissionsToCsv } from './submissions/csv'

export type {
  StoragePort,
  PutOptions,
  StoredObject
} from './storage/storage-port'

export type { EmailMessage, EmailPort } from './email/email-port'

export type {
  ImageFormat,
  VariantSpec,
  ImageMeta,
  GeneratedVariant,
  ImagePort
} from './image/image-port'
export { extensionFor, contentTypeFor } from './image/format'
export type { ManifestVariant, MediaManifest } from './image/manifest'
export { ingestImage } from './image/ingest'
export type { IngestDeps, IngestInput } from './image/ingest'
export {
  mediaSlug,
  mediaKeyOf,
  originalKey,
  variantKey,
  manifestKey,
  mediaRecordKey
} from './image/media-key'

export type {
  MediaRecord,
  MediaIndexRow,
  MediaSortKey,
  MediaIndexQuery,
  MediaIndexMeta,
  MediaIndexPort
} from './media-index/types'
export { mediaRowFromRecord } from './media-index/types'
export { runMediaQuery } from './media-index/run-media-query'
export type { MediaKind } from './media-index/media-kind'
export { mediaKind } from './media-index/media-kind'
export type {
  MediaIndexService,
  MediaIndexServiceDeps
} from './media-index/media-index-service'
export {
  createMediaIndexService,
  MEDIA_INDEX_VERSION
} from './media-index/media-index-service'

export type {
  AuthoringService,
  OpenResult,
  SaveResult,
  LockStatus,
  LockOutcome,
  AuthoringDeps
} from './authoring/types'
export { DEFAULT_LOCK_TTL_MS } from './authoring/types'
export { createAuthoringService } from './authoring/authoring-service'

export type {
  GitAuthor,
  CommitInput,
  CommitResult,
  FileChange,
  CommitFilesInput
} from './git/types'
export type { GitPort } from './git/git-port'

export type {
  PublishInput,
  PublishDeps,
  PublishResult,
  PublishService
} from './publish/types'
export { contentPath, parseContentPath } from './publish/content-path'
export { createPublishService } from './publish/publish-service'

export type { LoadResult, ReadDeps, ReadService } from './read/types'
export { createReadService } from './read/read-service'

export type { MdocFile } from './markdoc/frontmatter'
export { parseMdoc, serializeMdoc } from './markdoc/frontmatter'

export type {
  Action,
  Role,
  Actor,
  PermissionMatrix,
  Authz
} from './authz/types'
export { createAuthz, DEFAULT_ROLES } from './authz/authz'

export type {
  LifecycleState,
  LifecyclePending,
  Lifecycle
} from './lifecycle/derive'
export { deriveLifecycle } from './lifecycle/derive'

export type {
  ContentRow,
  ListContentEntriesInput
} from './content-index/list-entries'
export { listContentEntries } from './content-index/list-entries'
export { extractMediaRefs } from './content-index/extract-media-refs'

export { entryUrlPath, DEFAULT_LOCALE } from './url/entry-url'

export type {
  EntryIndexRow,
  SortKey,
  IndexQuery,
  IndexMeta,
  IndexPort
} from './index-port/types'
export { indexKey, projectRow, rowToContentRow } from './index-port/types'
export { runQuery } from './index-port/run-query'
export {
  selectDistinctTags,
  selectDistinctLocales
} from './index-port/distinct-tags'
export { selectCategoryCounts } from './index-port/category-counts'
export { selectTagCounts } from './index-port/tag-counts'
export { selectEntriesByCategory } from './index-port/entries-by-category'
export { selectEntriesByTag } from './index-port/entries-by-tag'
export type {
  RelatedRow,
  RelatedRef,
  RelatedOpts
} from './index-port/related-posts'
export { selectRelatedPosts } from './index-port/related-posts'
export type { PostRow, PostsQuery } from './posts/select-posts'
export { selectPosts } from './posts/select-posts'
export { excerpt } from './content/excerpt'
export type { SeoPage, SeoMetaTag, ResolvedSeo } from './seo/resolve-seo'
export { resolveSeo } from './seo/resolve-seo'
export type { JsonLdInput, JsonLdGraph } from './seo/json-ld'
export { resolveJsonLd, jsonLdScript } from './seo/json-ld'
export type { PageSeoOverride } from './seo/page-override'
export { parsePageSeoOverride } from './seo/page-override'
export {
  distinctCategorySlugs,
  distinctTagSlugs,
  categoryNameMap
} from './posts/archive-slugs'
export type { MediaUsage } from './index-port/referenced-by'
export { selectReferencedBy } from './index-port/referenced-by'
export type { IndexService, IndexServiceDeps } from './index-port/index-service'
export { createIndexService, INDEX_VERSION } from './index-port/index-service'

export type { Category, CategoryNode } from './taxonomy/types'
export { parseCategories, serializeCategories } from './taxonomy/parse'
export { buildTree } from './taxonomy/tree'
export {
  addCategory,
  removeCategory,
  renameLabel,
  reparent,
  slugify,
  TaxonomyError
} from './taxonomy/ops'
export type { TaxonomyErrorCode } from './taxonomy/ops'
export type { TaxonomyService } from './taxonomy/service'
export { createTaxonomyService, TAXONOMY_PATH } from './taxonomy/service'
export { createCategoryDeleter } from './taxonomy/delete-service'
export type { CategoryDeleterDeps } from './taxonomy/delete-service'

export { normalizeTag, normalizeTags } from './tags/normalize'

// Bulk metadata mutations — note: aliased due to conflict with taxonomy/ops addCategory
export {
  addCategory as bulkAddCategory,
  removeCategory as bulkRemoveCategory,
  addTag as bulkAddTag,
  removeTag as bulkRemoveTag
} from './bulk/mutations'
export type { BulkService, BulkDeps, BulkResult } from './bulk/bulk-service'
export { createBulkService } from './bulk/bulk-service'

export type { MarkdocAttr } from './blocks/markdoc-attributes'
export { markdocAttributesFor } from './blocks/markdoc-attributes'

export { resolveControls } from './blocks/resolve-controls'
export type { ResolvedControl } from './blocks/resolve-controls'
export type { BlockControl } from './config/types'

export type { BlockContract } from './blocks/define-block'
export { defineBlock } from './blocks/define-block'
export type { BlockEntry, BlockRegistry } from './blocks/registry'
export { buildRegistry } from './blocks/registry'
export type { BlockCategory } from './blocks/categories'
export {
  BLOCK_CATEGORIES,
  BLOCK_CATEGORY_LABELS,
  DEFAULT_BLOCK_CATEGORY,
  isBlockCategory
} from './blocks/categories'

export type { StandardBlock } from './blocks/standard/types'
export { STANDARD_BLOCKS } from './blocks/standard'
export { mergeBlockSources } from './blocks/merge-sources'

export type { CaptchaPort } from './captcha/captcha-port'
export { createNoopCaptcha } from './captcha/captcha-port'

export type {
  Severity,
  HealthCategory,
  Owner,
  CheckStatus,
  RubricItem,
  SiteCapabilities,
  AuditEntry,
  AuditContext,
  CheckResult,
  CategoryScore,
  AuditResult,
  AttestationRecord,
  HealthState
} from './health/types'
export { RUBRIC } from './health/rubric'
export { SITE_CAPABILITIES } from './health/capabilities'
export { scanBody } from './health/scan'
export { EVALUATORS, APPLIES_WHEN } from './health/checks'
export { runAudit } from './health/run-audit'
export { parseHealthState, setHealthRecord } from './health/health-state'

export type {
  ReprocessStatus,
  ReprocessJob,
  ReprocessJobStore
} from './reprocess/job'
