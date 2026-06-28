# Setu quality bar

Setu's wedge is editor quality and polish. A feature that "works" but feels sub-par is a net
negative — it sets the product's perceived quality, and the owner has to find every gap in UAT.
This document is the standard. The short version lives in [CLAUDE.md](../CLAUDE.md); this is the
detail, the rubric, and a worked example.

## The Definition of Done (expanded)

A feature is DONE only when every item is true. Tests passing is necessary, never sufficient.

### 1. You drove it in the running app
- Launch the real app (`pnpm dev` or the relevant slice) and click through the actual user flow the
  feature changes. Not "it built" — *you used it.*
- For UI, that means: insert/open the thing, operate every control, watch it update, publish/save,
  and confirm the result renders.
- If you have not used it, it is a **draft**, not a feature. Say so honestly.

### 2. It matches the agreed design
- Non-trivial UI gets a design first: a mockup (use the visual tooling) or a named reference
  ("WordPress Query Loop block", "Notion property panel"). Get the owner's nod on the design.
- Then build to it. If the agreed design has a columns control, a live preview, and dropdowns, the
  build has all three. Shipping a subset of an approved design is a **defect** — flag it as
  incomplete, never present it as done or as an "increment."

### 3. It reuses what exists
- Survey first: grep for existing components, fields, hooks, patterns. Setu already has taxonomy
  pickers (`CategoryField`, `TagAutocomplete`), the block inspector + control-hints, the media
  picker, the meta-panel field patterns, the content index.
- Never hand-roll a worse version of something that exists. If the existing thing is close but not
  reusable, extend it; don't fork a degraded copy.

### 4. Table-stakes UX
- **Known set of options → a dropdown/picker.** Never make the user type a value the system already
  knows (a collection name, a category slug, an enum).
- **Open-ended references → a searchable picker** (type-ahead + chips), never a raw text box for
  slugs/ids.
- **Show, don't describe.** Where the user expects to see the result (a query's posts, an image),
  render a live preview in place.
- **Group and label** controls sensibly. A flat stack of inputs is a skeleton, not a panel.

### 5. No skeletons
- The most common failure mode here: ship the data-layer + the bones, defer the polish, call it an
  "increment." That removes exactly what makes the feature good.
- If you must split work, split it so each piece is *complete and polished on its own*, not
  "functional but ugly now, pretty later." Polish is not a follow-up ticket.

### 6. Self-critique before declaring done
- Look at it as the owner would. Would they call it polished, or would they immediately find three
  gaps? If the latter, it's not done — find them first.

## Review rubric (paste into every whole-branch review)

The whole-branch review must return a **polish + UAT verdict** in addition to spec/correctness, and
**block merge** if any answer is "no":

- **Driven in the app?** Did the implementer actually run it and click through the user flow (and say
  so, with what they saw)? "Tests pass" is not evidence of this.
- **Matches the agreed design?** Compare against the mockup/reference. List anything the design has
  that the build dropped.
- **Reuses existing components?** Did it hand-roll something Setu already has?
- **Complete, not a skeleton?** Are any "make-it-good" parts (controls, preview, polish, grouping)
  missing or deferred?
- **Table-stakes UX?** Any raw text inputs for known/enumerable values? Any place the user must type
  what they should pick? Any missing live preview?

A correct, well-tested, **skeleton** feature is `Needs fixes`, not `Approved`.

## Worked example: the Query block (what NOT to do, and what done looks like)

This is a real case from this codebase — keep it as the reference.

**The skeleton that was shipped (a defect):**
- The block config rendered as a bare stack of shadcn inputs in the inspector.
- `collection` was a **raw text box** — the user had to type "post" — even though the whole point of
  the prior feedback was "stop making me type."
- **No columns control**, although the agreed mockup had one.
- The block **did not render in the editor** — inserting it showed empty chrome, so it felt broken.
- It was presented as "Increment 1, done" after tests passed — without anyone driving it.

**What done actually looks like (the agreed mockup):**
- `collection` is a **dropdown**; `category`/`tag` are **searchable pickers** (reusing
  `CategoryField`/`TagAutocomplete`); `sort`/`layout` are dropdowns; `showImage` a switch.
- A **columns** control (stepper) that the grid honors.
- The block **renders a live preview** of the matching posts in the editor canvas (query the content
  index), so it looks like the published result — WordPress Query Loop behaviour.
- Grouped sections (Content / Layout / Pagination), not a flat list.
- It was **driven in the app** — block inserted, every control operated, preview watched to
  re-render, published — *before* being shown to the owner.

The difference between the two is the entire product. Build the second one.
