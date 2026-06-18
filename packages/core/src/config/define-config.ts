import type { SetuConfig } from './types'

/** Identity helper: exists purely so authors get type inference and a stable import. */
export const defineConfig = (config: SetuConfig): SetuConfig => config
