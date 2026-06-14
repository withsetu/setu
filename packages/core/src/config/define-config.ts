import type { SaytuConfig } from './types'

/** Identity helper: exists purely so authors get type inference and a stable import. */
export const defineConfig = (config: SaytuConfig): SaytuConfig => config
