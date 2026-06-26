/** The General settings group. title/tagline/description are consumed by the
 *  site; timezone/dateFormat are stored now and consumed when date display lands. */
export interface GeneralSettings {
  title: string
  tagline: string
  description: string
  timezone: string
  dateFormat: string
}

/** Site settings, grouped so future sections (identity/content/media/forms) add
 *  cleanly. Persisted as a Git-backed settings.json. Never holds secrets. */
export interface SiteSettings {
  general: GeneralSettings
}
