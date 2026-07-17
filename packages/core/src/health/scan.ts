// scanBody moved to the edge-safe, layering-neutral `markdoc/scan-body` (#593) so
// the content-index projection can precompute image-alt / H1 facts at build time
// without importing the health feature. Re-exported here for existing callers.
export { scanBody } from '../markdoc/scan-body'
