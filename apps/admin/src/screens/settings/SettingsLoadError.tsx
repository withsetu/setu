import { Button } from '@/components/ui/button'

/** Shown in place of a settings form (and as the toast) when its baseline read from Git fails. */
export const SETTINGS_LOAD_FAILED_MESSAGE =
  "Couldn't load these settings. Check your connection and try again."

/** A settings screen that could not read its baseline must NOT fall through to the form, because
 *  the form then shows DEFAULT values under a disabled button reading "Saved" — a confident success
 *  label over settings that were never read (#837, the #782 failure mode). This announced
 *  (role="alert") error + retry takes the form's place instead, so the failure is distinguishable
 *  from a real "nothing to save" state. Exercised by apps/admin/test/settings-load-error.test.tsx. */
export function SettingsLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex max-w-xl flex-col items-start gap-3 rounded-lg border border-border/60 px-5 py-8"
    >
      <p className="text-sm text-muted-foreground">
        {SETTINGS_LOAD_FAILED_MESSAGE}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
