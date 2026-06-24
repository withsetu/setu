# Admin command palette (⌘⇧P / ⌘K)

Status: approved design, ready for plan
Date: 2026-06-24
A standalone app-wide feature (slots between editor-chrome PR A and PR B). Part of [[setu-admin-shadcn-migration]].

## Goal

An app-wide command palette opened by **⌘⇧P** or **⌘K**: a fuzzy-searchable, grouped list of
runnable actions backed by a **dynamic action registry** that any screen can contribute to while
mounted. Ships with global actions (navigate, create, deploy, theme) plus context-aware **editor**
actions (Publish / Preview / Unpublish) registered only while the editor is open.

## Why a registry (not a hardcoded list)

The value is extensibility: future surfaces register their own commands without touching the palette.
A dynamic registry (register on mount / unregister on unmount) makes the palette context-aware for
free — the editor's actions appear only when editing — and keeps each action's closure next to the
state it needs (the editor's publish handlers stay in `EditorScreen`).

## Current state (relevant seams)

- `apps/admin/src/components/ui/command.tsx` — shadcn `CommandDialog` (props `open`/`onOpenChange`/
  `title`/`description`/`showCloseButton`) + `CommandInput`/`CommandList`/`CommandGroup`/`CommandItem`/
  `CommandEmpty`/`CommandSeparator`. cmdk `^1.1.1`. Used today only in the editor SlashCommand.
- Routes (`app.tsx`): `/dashboard`, `/posts`, `/pages`, `/taxonomies`, `/media`, `/appearance`,
  `/settings`, `/edit/:collection/:locale/:slug`. Nav via `useNavigate()`.
- New entry: `Link to="/edit/{collection}/en/new"` (slug sentinel `NEW_SLUG = 'new'`).
- Deploy: `useDeploy()` → `{ deploy(), sha, deployedAt }`; gated `can('site.deploy')`.
- Theme: `shell/ThemeToggle.tsx` flips `document.documentElement[data-theme]` + `localStorage('setu-theme')`
  (logic currently inline in the component).
- Permissions: `useCan()` (actions incl. `content.publish`, `content.unpublish`, `site.deploy`).
- Editor handlers (LOCAL to `EditorScreen`): `onPublish`/`onUnpublish`/`onRepublish`/`onPreview`,
  gating `can('content.publish') && phase==='ready' && !composing` (and `previewApi && !composing`).
- Existing global keydown: only the sidebar's ⌘B (`components/ui/sidebar.tsx`). No ⌘K/⌘P yet.
- Provider tree (`main.tsx`): … `ActorProvider` → `DeployProvider` → `IndexProvider` → … → `App`.

## Architecture

### Action model

```ts
export interface CommandAction {
  id: string                 // stable unique key (e.g. 'nav.posts', 'editor.publish')
  title: string              // shown + searched
  group: string              // section heading ('Create' | 'Go to' | 'Site' | 'Editor' | …)
  keywords?: string          // extra search terms (space-joined)
  icon?: LucideIcon          // optional leading icon
  run: () => void            // invoked on select (after the palette closes)
  enabled?: () => boolean    // when false, the action is filtered OUT (not shown greyed)
}
```

### Registry (`command/registry.tsx`)

- `CommandRegistryProvider` — holds a `Map<string, CommandAction>` in state; exposes
  `register(actions: CommandAction[]): () => void` (returns an unregister) and `list(): CommandAction[]`.
  Dependency-light (no router/auth imports) so it can sit high in the tree.
- `useCommandRegistry()` — returns `{ list }` for the palette.
- `useRegisterCommands(actions: CommandAction[], deps: unknown[])` — registers on mount, unregisters
  on unmount, re-registers when `deps` change. The ergonomic API every registrant uses. Actions are
  keyed by `id`, so re-registration replaces cleanly and last-writer-wins on duplicate ids.

### Palette (`command/CommandPalette.tsx`)

- Owns `open` state. A `useEffect` global `keydown` listener opens on **(meta||ctrl)+K** or
  **(meta||ctrl)+shift+KeyP**, `preventDefault`-ing both (⌘⇧P specifically, NOT ⌘P, so browser print
  is untouched). Toggling closed on the same combos is fine.
- Renders `CommandDialog` → `CommandInput` (placeholder "Type a command or search…") → `CommandList`
  with `CommandEmpty` + one `CommandGroup` per distinct group (stable group order:
  `Editor, Create, Go to, Site`, then any others alphabetically). Each enabled action → `CommandItem`
  whose `value` is `\`${title} ${keywords ?? ''}\`` (cmdk fuzzy-searches `value`), `onSelect` = close
  then `action.run()`.
- Filters `list()` through `enabled?.() !== false` before grouping.
- The footer hint (⌘⇧P / ⌘K · ↑↓ · ↵) is optional polish via the CommandDialog content.

### Global actions (`command/GlobalCommands.tsx`)

A `null`-rendering component mounted inside `AppShell` (so router + providers are available). Calls
`useRegisterCommands` with:
- **Create:** `New post` → `navigate('/edit/post/en/new')`; `New page` → `/edit/page/en/new`.
- **Go to:** Dashboard, Posts, Pages, Taxonomies, Media, Appearance, Settings → `navigate(path)`.
- **Site:** `Deploy site` → `void deploy()` (+ a notify), `enabled: () => can('site.deploy')`;
  `Toggle theme` → `toggleTheme()`.
deps: `[navigate, deploy, can]` (so the closures stay fresh).

### Theme util (`shell/theme.ts`) — small DRY extraction

Extract the toggle logic from `ThemeToggle.tsx` into `toggleTheme()` + `currentTheme()` so both the
toggle button and the command action call one implementation (no duplicated DOM/localStorage logic).
`ThemeToggle` is refactored to use them; behavior identical.

### Editor actions (context-aware)

`EditorScreen` calls `useRegisterCommands` with:
- `Publish` → `onPublish()`, `enabled: () => can('content.publish') && phase==='ready' && !composing`.
- `Preview draft` → `void onPreview()`, `enabled: () => Boolean(previewApi) && !composing`.
- `Unpublish` → `onUnpublish()`, `enabled: () => can('content.unpublish') && phase==='ready' && !composing && metadata['published'] !== false`.
group `'Editor'`, deps `[phase, composing, metadata, can]`. Registered while EditorScreen is mounted,
auto-unregistered on navigate-away — so the Editor group only appears in the palette while editing.

### Wiring

- `main.tsx`: add `CommandRegistryProvider` (after `DeployProvider`/`ActorProvider`, before/around
  the rest) so all registrants + the palette share one registry.
- `AppShell`: mount `<GlobalCommands />` and `<CommandPalette />` once (inside the router + providers).

## Data flow

Registrant mounts → `useRegisterCommands` puts its actions in the registry Map → palette opens
(keybinding) → reads `list()`, filters `enabled`, groups → renders → user selects → palette closes →
`action.run()` fires. Async runs (deploy) are fire-and-forget with a notify.

## Error handling

- Deploy failures surface via `useNotify().error` inside the action's `run` (mirroring the sidebar
  Deploy button).
- Unknown/disabled actions can't be selected (filtered out before render).
- Duplicate `id` → last registration wins (documented; ids are namespaced like `nav.posts`).

## Testing

- **Registry (`registry.test.tsx`):** `register` adds actions + returns a working unregister;
  `useRegisterCommands` registers on mount and removes on unmount; duplicate id replaces.
- **Palette (`CommandPalette.test.tsx`):** ⌘K and ⌘⇧P open it (dispatch keydown); typing filters
  (cmdk); selecting an item closes the palette and calls the action's `run`; an action whose
  `enabled()` is false does not render; groups render under their headings. Use the established Radix/
  cmdk jsdom workarounds (scrollIntoView stub; the project's existing patterns).
- **GlobalCommands:** mounting registers the global actions (assert they appear in the palette);
  Deploy hidden when `can('site.deploy')` is false.
- **Editor actions:** while EditorScreen is mounted, Publish appears in the palette and invokes the
  publish flow; it's gated out when composing/!ready. (Extend the existing editor test harness.)
- Full gate: `pnpm typecheck && pnpm test && pnpm build` green (typecheck included — vitest doesn't typecheck).

## Out of scope (later)

- Recents/frequency ranking, nested/sub-command menus, per-action display shortcuts, search over
  CONTENT (jump-to-post) — the registry makes these additive later.
- Touch/mobile affordance (admin is desktop-only).

## Decomposition (for the plan)

1. `command/registry.tsx` — provider + `useCommandRegistry` + `useRegisterCommands` (TDD).
2. `shell/theme.ts` — extract `toggleTheme`/`currentTheme`; refactor `ThemeToggle` to use them (TDD).
3. `command/CommandPalette.tsx` — dialog + keybinding + grouped/filtered render + run-on-select (TDD).
4. `command/GlobalCommands.tsx` — global actions (nav/create/deploy/theme) (TDD).
5. Wire `CommandRegistryProvider` (main.tsx) + mount palette/global in `AppShell`; integration test.
6. Editor context actions via `useRegisterCommands` in `EditorScreen` (TDD).

Built subagent-driven per [[setu-execution-default]]; editor-visible spot-check at the end.
