// Test-only theme fixture for apps/site/test/theme-options-invalid-build.test.ts (#1294): a
// declaration whose SECOND option has a token that is not a CSS custom property. The build must
// fail naming `headline`, not ship a page whose override is broken. Only `./options` is needed —
// validation runs at config time, before any page renders through the theme.
export const themeOptions = [
  {
    key: 'accent',
    label: 'Accent',
    type: 'color',
    token: '--accent',
    default: '#123456'
  },
  {
    key: 'headline',
    label: 'Headline colour',
    type: 'color',
    token: 'headline-color',
    default: '#000000'
  }
]
