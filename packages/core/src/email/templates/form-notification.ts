import { escapeHtml, type TokenValues } from '../../templating/fill-template'
import {
  EMAIL_TYPE_FORM_NOTIFICATION,
  type EmailTypeDefinition
} from '../template-registry'

/** One label/value row, both halves escaped. `white-space:pre-wrap` preserves a multi-line
 *  message field, which is what the pre-#499 React Email version did too. */
const rowHtml = (name: string, value: string): string =>
  `<tr><td style="padding:4px 16px 4px 0;color:#71717a;vertical-align:top;white-space:nowrap">${escapeHtml(
    name
  )}</td><td style="padding:4px 0;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`

/** A stable, locale-independent UTC stamp — `2026-01-15 09:41 UTC`. Deliberately not
 *  `toLocaleString`: this renders on a server (and in the edge topology) whose locale and
 *  timezone are not the reader's, and the editor preview must be byte-reproducible. Honoring
 *  Settings → General's timezone/dateFormat is a separate job — they are stored but not yet
 *  consumed anywhere. */
const utcStamp = (ms: number): string =>
  `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`

/** Structural shape of a stored submission — core's `Submission` satisfies it, without this
 *  module depending on the submissions types. */
export interface FormNotificationInput {
  id: string
  formId: string
  formLabel?: string
  fields: Record<string, string>
  createdAt: number
}

/**
 * Build the token values for one form-notification send — the single producer of `{{fields}}`,
 * and therefore the single place submitter-supplied text is escaped.
 */
export function formNotificationValues(
  submission: FormNotificationInput,
  siteTitle?: string
): TokenValues {
  const entries = Object.entries(submission.fields)
  return {
    form_label: submission.formLabel ?? submission.formId,
    form_id: submission.formId,
    submission_id: submission.id,
    submitted_at: utcStamp(submission.createdAt),
    // Omitted rather than '' when unknown, so apps/api's ambient live site title can fill it in
    // (apps/api/test/email-templates.test.ts, "folds the live site title into the values").
    ...(siteTitle === undefined ? {} : { site_title: siteTitle }),
    fields: {
      html: entries.map(([k, v]) => rowHtml(k, v)).join('\n'),
      // The text half needs no escaping — there is no markup context to break out of — but it
      // does need indenting so a multi-line value stays visibly part of its field.
      text: entries
        .map(([k, v]) => `${k}: ${v.replace(/\n/g, '\n  ')}`)
        .join('\n')
    }
  }
}

/**
 * The `form-notification` email type (#499, epic #497) — sent to the site's notify address when
 * a visitor submits a form.
 *
 * **Why this default is a hand-written template rather than the pre-#499 bytes.** Until #499
 * this email was rendered by React Email JSX in `@setu/email-templates`, whose output is ~3 KB
 * of nested presentational tables carrying React's own `<!--$-->` hydration markers. Two
 * reasons that could not become the registry default:
 *
 * 1. A flat `{{token}}` grammar has no loop, so it cannot emit one row per submitted field.
 *    The industry answer (WooCommerce's `{order_table}`, and what is used here) is a
 *    pre-rendered block token — `{{fields}}`, composed by {@link formNotificationValues}.
 * 2. The default template IS the text an admin edits in Settings → Email. Handing them 3 KB of
 *    React-Email table soup would be the raw-text-box failure mode at scale; nobody would
 *    customize it, which is the entire feature.
 *
 * So the markup changed deliberately while the CONTENT did not: the subject line is preserved
 * byte-for-byte (`New submission: <label>`, pinned by
 * packages/core/test/email/email-registry.test.ts), and the body still shows the same heading
 * and the same label/value rows, still as inline-styled tables for Outlook's benefit. Password
 * reset — the type whose pre-#499 default WAS an editable string — is byte-identical.
 */
export const FORM_NOTIFICATION_EMAIL: EmailTypeDefinition = {
  id: EMAIL_TYPE_FORM_NOTIFICATION,
  label: 'Form notification',
  description:
    'Sent to your notification address every time a visitor submits a form on your site.',
  tokens: [
    {
      name: 'form_label',
      description:
        'The form’s display label, falling back to its id when it has none.'
    },
    { name: 'form_id', description: 'The form’s id, e.g. “contact”.' },
    {
      name: 'fields',
      description:
        'Every submitted field as label/value rows — a table in the HTML body, indented lines in the plain-text one.',
      // The value is markup, composed by formNotificationValues above, which escapes every
      // submitter-supplied name and value on the way in. That per-field escaping is the ONLY
      // thing standing between an anonymous form submitter and an admin's mail client, so it is
      // kill-shot tested in packages/core/test/email/email-registry.test.ts ("escapes
      // submitter-supplied field names and values inside the {{fields}} block").
      rawHtml: true
    },
    { name: 'submitted_at', description: 'When it was submitted (UTC).' },
    { name: 'submission_id', description: 'The stored submission’s id.' },
    {
      name: 'site_title',
      description: 'Your site title, from Settings → General.'
    }
  ],
  defaultSubject: 'New submission: {{form_label}}',
  defaultHtml: `<h2 style="font-family:system-ui,sans-serif;font-size:20px;margin:0 0 16px">New submission: {{form_label}}</h2>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:system-ui,sans-serif;font-size:14px;border-collapse:collapse">
{{fields}}
</table>
<p style="font-family:system-ui,sans-serif;font-size:12px;color:#71717a;margin:16px 0 0">Submitted {{submitted_at}} · form {{form_id}}</p>`,
  defaultText: `New submission on "{{form_label}}"

{{fields}}

Submitted {{submitted_at}} · form {{form_id}}`,
  // The preview's sample values go through the SAME builder a real send uses, so the editor
  // exercises real value shapes (a `{ html, text }` pair stays a pair) rather than a
  // hand-written approximation that could drift from it.
  sampleValues: formNotificationValues(
    {
      id: 'sub_example',
      formId: 'contact',
      formLabel: 'Contact',
      fields: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        message: 'Hello — I’d like to know more about your work.'
      },
      createdAt: Date.UTC(2026, 0, 15, 9, 41)
    },
    'Example Site'
  )
}
