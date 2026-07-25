import { createEmailTypeRegistry } from '../template-registry'
import { PASSWORD_RESET_EMAIL } from './password-reset'
import { FORM_NOTIFICATION_EMAIL } from './form-notification'

/**
 * The registry every send path and the admin editor share (#499, epic #497).
 *
 * Core's own two types are added through the SAME public `register` call a plugin would use
 * (#302's extension seam), deliberately rather than a privileged internal path — that is what
 * keeps the third-party road exercised by the tests that matter
 * (packages/core/test/email/email-registry.test.ts).
 *
 * Registration order is list order, which is the order Settings → Email renders the types in.
 */
export const EMAIL_TYPES = createEmailTypeRegistry()
EMAIL_TYPES.register(PASSWORD_RESET_EMAIL)
EMAIL_TYPES.register(FORM_NOTIFICATION_EMAIL)
