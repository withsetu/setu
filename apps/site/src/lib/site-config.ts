import config from '../../saytu.config'

/** Theme option values from saytu.config (the build's single source of truth).
 *  Empty object when unset → the theme renders its declared defaults. */
export const themeOptions: Record<string, string> = config.themeOptions ?? {}
