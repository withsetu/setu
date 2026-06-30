/** Single source of the Setu version string, surfaced in machine-readable places that advertise
 *  the generator (RSS `<generator>`, the SEO `<meta name="generator">`, etc.). Bump on release. */
export const SETU_VERSION = '1.0'

/** WordPress-style generator URL, e.g. `https://setu.build/?v=1.0`. */
export const GENERATOR_URL = `https://setu.build/?v=${SETU_VERSION}`
