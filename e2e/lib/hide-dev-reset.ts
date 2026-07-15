import type { Page } from '@playwright/test'

/** Hide `main.tsx`'s dev-only "Reset to sample content" floating button (`DevReset`) before
 *  clicking the sidebar-footer user menu.
 *
 *  #492: the overlay is fixed at bottom-left — the exact corner the user-menu button sits in —
 *  and intercepts its pointer events under the vite dev server the e2e harness runs against.
 *  It is `import.meta.env.DEV`-gated (dead-code-eliminated from real builds — never a product
 *  surface), so hiding it costs nothing in product coverage; `a11y.spec.ts` excludes it from its
 *  scans for the same reason. Remove this helper when #492 lands a real fix. */
export async function hideDevReset(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '.dev-reset { display: none !important; }'
  })
}
