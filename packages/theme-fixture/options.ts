// The fixture theme's Customizer declaration — data, not code (#342). Setu applies it: the site
// writes the `optionsToCss` override into every page itself (#1294), so nothing in this theme
// calls it.
//
// The keys are deliberately NOT theme-default's (`highlight`, `typeface`, `measure` rather than
// `accent`, `font`, `width`): the point of this theme is to prove that nothing outside a theme
// depends on one theme's key names. The font option is found by `role: 'typeface'` (#1295).
import type { ThemeOption } from '@setu/core'

const serif = (name: string) =>
  `'${name} Variable', '${name}', ui-serif, Georgia, serif`
const sans = (name: string) =>
  `'${name} Variable', '${name}', ui-sans-serif, system-ui, sans-serif`

export const themeOptions: ThemeOption[] = [
  {
    key: 'highlight',
    label: 'Highlight colour',
    type: 'color',
    token: '--accent',
    default: '#b4532a'
  },
  {
    key: 'typeface',
    label: 'Typeface',
    type: 'select',
    role: 'typeface',
    token: ['--font-body', '--font-heading'],
    default: 'fraunces',
    choices: [
      {
        value: 'fraunces',
        label: 'Fraunces (default)',
        tokenValue: serif('Fraunces')
      },
      {
        value: 'literata',
        label: 'Literata',
        tokenValue: serif('Literata')
      },
      {
        value: 'bricolage',
        label: 'Bricolage Grotesque',
        tokenValue: sans('Bricolage Grotesque')
      }
    ]
  },
  {
    key: 'measure',
    label: 'Reading width',
    type: 'select',
    token: '--measure-post',
    default: 'standard',
    choices: [
      { value: 'snug', label: 'Snug', tokenValue: '34rem' },
      { value: 'standard', label: 'Standard', tokenValue: '40rem' },
      { value: 'roomy', label: 'Roomy', tokenValue: '46rem' }
    ]
  }
]
