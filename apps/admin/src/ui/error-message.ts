export function connectionError(action: string): string {
  return `Couldn't ${action}. Check your connection and try again.`
}
