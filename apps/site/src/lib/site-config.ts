import config from '../../setu.config'

/** Theme option values from setu.config (the build's single source of truth).
 *  Empty object when unset → the theme renders its declared defaults. */
export const themeOptions: Record<string, string> = config.themeOptions ?? {}
