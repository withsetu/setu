# Admin UI Conventions

The admin (`@setu/admin`) is built on shadcn/ui. New UI MUST follow these rules.

## Components
- Use primitives from `@/components/ui/*`. Do not hand-roll buttons, inputs, dialogs, menus, popovers, tooltips, tables, badges.
- Icons: `lucide-react` only.
- Compose with `cn()` from `@/lib/utils`; never concatenate class strings by hand.

## Tokens
- Use ONLY the standard shadcn token set + the `success`/`warning`/`info` trio.
- Never introduce new custom CSS variable names or new `.bespoke` CSS classes.
- Style with Tailwind utility classes bound to tokens (`bg-card`, `text-muted-foreground`, `border-input`, `bg-success`).
- `--accent` is the hover/selected surface, NOT the brand. Brand = `--primary`.
- Dark mode: `[data-theme="dark"]`.

## Motion (restraint)
- One engine: `motion` (`motion/react`). Use sparingly — route/state transitions, list enter, optimistic UI.
- Loaders: shadcn `Skeleton`, not spinners. Toasts: `sonner`. Command palette: `cmdk` via `Command`.
- Honor `prefers-reduced-motion`.
- NEVER add landing-page effect libraries (Aceternity/Magic UI/React Bits/Three.js backgrounds) to the admin.

## The TipTap editor canvas
- The canvas keeps its custom rendering. Build its chrome (menus, dialogs, inputs) from shadcn primitives + tokens.
