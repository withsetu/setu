// #1076: the model and its resolvers moved to @setu/core so they apply to ANY theme's
// declaration. A theme now ships only the DECLARATION below — data, not code — because the admin
// is a browser bundle and cannot import an installed theme's module at runtime.
import type { ThemeOption } from '@setu/core'

export type {
  ThemeOption,
  ThemeOptionChoice,
  ThemeOptionType
} from '@setu/core'

const sans = (name: string) =>
  `'${name} Variable', '${name}', ui-sans-serif, system-ui, sans-serif`
const serif = (name: string) =>
  `'${name} Variable', '${name}', ui-serif, Georgia, serif`

export const themeOptions: ThemeOption[] = [
  {
    key: 'accent',
    label: 'Accent color',
    type: 'color',
    token: '--accent',
    default: '#4f46e5'
  },
  {
    key: 'font',
    label: 'Font',
    type: 'select',
    token: ['--font-body', '--font-heading'],
    default: 'grotesk',
    choices: [
      {
        value: 'grotesk',
        label: 'Grotesk (default)',
        tokenValue: sans('Hanken Grotesk')
      },
      { value: 'inter', label: 'Inter', tokenValue: sans('Inter') },
      {
        value: 'source-serif',
        label: 'Serif (Source Serif)',
        tokenValue: serif('Source Serif 4')
      },
      {
        value: 'newsreader',
        label: 'Literary (Newsreader)',
        tokenValue: serif('Newsreader')
      },
      { value: 'lora', label: 'Warm serif (Lora)', tokenValue: serif('Lora') },
      {
        value: 'space',
        label: 'Space Grotesk',
        tokenValue: sans('Space Grotesk')
      }
    ]
  },
  {
    key: 'width',
    label: 'Content width',
    type: 'select',
    token: '--measure-page',
    default: 'normal',
    choices: [
      { value: 'narrow', label: 'Narrow', tokenValue: '52rem' },
      { value: 'normal', label: 'Normal', tokenValue: '64rem' },
      { value: 'wide', label: 'Wide', tokenValue: '78rem' }
    ]
  },
  {
    key: 'textSize',
    label: 'Text size',
    type: 'select',
    token: '--text-base',
    default: 'normal',
    choices: [
      { value: 'compact', label: 'Compact', tokenValue: '1rem' },
      { value: 'normal', label: 'Normal', tokenValue: '1.0625rem' },
      { value: 'comfy', label: 'Comfy', tokenValue: '1.1875rem' }
    ]
  },
  {
    key: 'corners',
    label: 'Corner style',
    type: 'select',
    token: '--radius-base',
    default: 'rounded',
    choices: [
      { value: 'sharp', label: 'Sharp', tokenValue: '2px' },
      { value: 'rounded', label: 'Rounded', tokenValue: '10px' }
    ]
  }
]
