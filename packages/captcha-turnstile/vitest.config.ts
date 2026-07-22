// Discovery contract lives in the repo-root vitest.shared.ts (#818). No local overrides.
// Added in #818: this package previously had NO config and ran on vitest's default
// `**/*.test.*` include — a second, unwritten discovery contract. Its collected file set
// is unchanged (all of its tests already live under test/).
export { default } from '../../vitest.shared'
