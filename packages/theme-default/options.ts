export type ThemeOptionType = 'color' | 'select'

export interface ThemeOptionChoice {
  value: string
  label: string
  /** What the driven token(s) become when this choice is selected. */
  tokenValue: string
}

export interface ThemeOption {
  key: string
  label: string
  type: ThemeOptionType
  /** The CSS custom property/properties this knob drives. */
  token: string | string[]
  /** Default *value*: a color for `color`; a choice `value` for `select`. */
  default: string
  choices?: ThemeOptionChoice[]
}

const sans = (name: string) => `'${name} Variable', '${name}', ui-sans-serif, system-ui, sans-serif`
const serif = (name: string) => `'${name} Variable', '${name}', ui-serif, Georgia, serif`

export const themeOptions: ThemeOption[] = [
  { key: 'accent', label: 'Accent color', type: 'color', token: '--accent', default: '#4f46e5' },
  {
    key: 'font',
    label: 'Font',
    type: 'select',
    token: ['--font-body', '--font-heading'],
    default: 'grotesk',
    choices: [
      { value: 'grotesk', label: 'Grotesk (default)', tokenValue: sans('Hanken Grotesk') },
      { value: 'inter', label: 'Inter', tokenValue: sans('Inter') },
      { value: 'source-serif', label: 'Serif (Source Serif)', tokenValue: serif('Source Serif 4') },
      { value: 'newsreader', label: 'Literary (Newsreader)', tokenValue: serif('Newsreader') },
      { value: 'lora', label: 'Warm serif (Lora)', tokenValue: serif('Lora') },
      { value: 'space', label: 'Space Grotesk', tokenValue: sans('Space Grotesk') },
    ],
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
      { value: 'wide', label: 'Wide', tokenValue: '78rem' },
    ],
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
      { value: 'comfy', label: 'Comfy', tokenValue: '1.1875rem' },
    ],
  },
  {
    key: 'corners',
    label: 'Corner style',
    type: 'select',
    token: '--radius-base',
    default: 'rounded',
    choices: [
      { value: 'sharp', label: 'Sharp', tokenValue: '2px' },
      { value: 'rounded', label: 'Rounded', tokenValue: '10px' },
    ],
  },
]

/** Accept a hex color (#rgb/#rgba/#rrggbb/#rrggbbaa). Anything else is invalid. */
function isValidColor(value: string | undefined): value is string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
}

function tokensOf(opt: ThemeOption): string[] {
  return Array.isArray(opt.token) ? opt.token : [opt.token]
}

/**
 * Pure: resolve chosen option values to the CSS custom properties they drive,
 * e.g. `{ '--accent': '#…', '--font-body': '…', '--font-heading': '…', … }`.
 * Missing/invalid values fall back to the option's default — a malformed config
 * can never emit garbage. Shared by `optionsToCss` (the published `:root:root`
 * override) and the admin Customizer's live preview (applied as inline custom
 * properties on the preview element), so the two can never disagree.
 */
export function resolveThemeTokens(values: Record<string, string>): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const opt of themeOptions) {
    const raw = values[opt.key]
    if (opt.type === 'color') {
      const value = isValidColor(raw) ? raw : opt.default
      for (const token of tokensOf(opt)) tokens[token] = value
    } else {
      const choices = opt.choices ?? []
      const choice =
        choices.find((c) => c.value === raw) ?? choices.find((c) => c.value === opt.default)
      if (!choice) continue
      for (const token of tokensOf(opt)) tokens[token] = choice.tokenValue
    }
  }
  return tokens
}

/**
 * Pure: map chosen option values to a `:root:root { … }` override string.
 *
 * The selector is intentionally doubled (`:root:root`, specificity 0,0,2,0)
 * so this override beats the theme's plain `:root` defaults (0,0,1,0) no
 * matter where Astro places the bundled theme CSS in the document — source
 * order alone is not enough (the bundled stylesheet loads after this inline
 * style). Not a typo.
 */
export function optionsToCss(values: Record<string, string>): string {
  const decls = Object.entries(resolveThemeTokens(values)).map(([token, value]) => `${token}: ${value};`)
  return `:root:root { ${decls.join(' ')} }`
}
