# Design Guidelines

Apply any UI work: `src/components/**`, `src/styles/**`. Ship production-grade, not prototypes — no unfinished states, no "good enough" spacing/contrast.

## Consult design reference files for non-trivial UI work

Any UI task beyond trivial one-line tweak: `Read` relevant reference file(s) before writing CSS/markup — carry far more depth than this summary. Self-contained in repo, no external plugin needed.

Always consult, every UI task (kept in `.claude/rules/design/`, auto-loaded):
- `design/layout.md` — layout, spacing, grid, container queries, optical adjustments
- `design/typeset.md` — type hierarchy, font selection, web font loading, OpenType features (Reference Material section)

Add based on what task touches (kept in `.claude/design-docs/`, NOT auto-loaded — `Read` on demand):
- Complex interactions/forms (`AlbumGenreEditor`, settings panels, modals) → `design-docs/interaction-design.md`
- Animation/transitions → `design-docs/animate.md` (Reference Material: motion materials, durations, easing, perceived performance)
- Color-heavy/theming → `design-docs/colorize.md` (Reference Material: OKLCH, palette structure, dark mode, contrast)
- Responsive/window-resize → `design-docs/adapt.md` (Reference Material: breakpoints, input methods, safe areas, responsive images)
- Heavy copy/labels/empty states/error messages → `design-docs/clarify.md` (Reference Material: button labels, error formula, voice/tone, translation)

On top of rules below, not instead — those stay fast-recall summary; reference files for depth when task warrants.

## Design tokens

Before writing any raw value (opacity, color, spacing, z-index, duration, radius) `grep -rn "^\s*--<prefix>-" src/App.css src/styles/` for existing token scale first. Steps, in order:

1. Search for a token family that covers the property (`--opacity-*`, `--space-*`, `--z-*`, `--duration-*`, `--tint-*`, etc.) in `src/App.css` (scale definitions) and `src/styles/`.
2. Pick the closest existing value to your intended visual result — don't just grab the nearest one lazily; check neighbors too (e.g. `--opacity-40` vs `--opacity-45`) and confirm which actually matches intent.
3. Grep where that token's already used elsewhere (`grep -rn "var(--opacity-40)" src/`) — if an existing usage is same context/purpose, matching it keeps consistency; if context differs, still fine to reuse, just note it's a different use case.
4. Genuinely nothing fits (gap in the scale, new category of value) → add new token to the scale in `App.css` next to its siblings, don't inline a magic number and don't invent an ad-hoc one-off var outside the scale.

Never ship a raw literal (`opacity: 0.4`, `z-index: 1000`, `#1a1a1a`) where a token scale for that property already exists in the codebase.

## Color

- Body text ≥4.5:1 contrast vs background. Large text (≥18px, or bold ≥14px) ≥3:1. Placeholder text same 4.5:1 bar as body — don't reach for default muted gray.
- Gray text on colored background looks washed out. Use darker shade of that background's own hue, or transparency of text color — not generic gray token.
- Canon's theme (`--bg-card`, `--bg-elevated`, `--accent`, etc. in `src/styles/`) already established dark. Don't introduce second accent or off-brand hue for new component — reuse existing tokens.

## Typography

- Cap body line length 65–75ch.
- Don't pair near-identical fonts (two geometric sans, two humanist sans). Contrast on axis (serif+sans, geometric+humanist) or vary weight within one family.
- Display heading ceiling: `clamp()` max ≤ 6rem. Letter-spacing floor ≥ -0.04em.
- Use `text-wrap: balance` on headings, `text-wrap: pretty` on long prose paragraphs.

## Layout

- Vary spacing for rhythm — don't apply one uniform gap everywhere.
- Cards lazy default. Reach for them only when genuinely best affordance. Never nest cards.
- Flexbox 1D layout, Grid 2D. Don't reach for Grid where `flex-wrap` does job.
- Responsive grids without explicit breakpoints: `repeat(auto-fit, minmax(280px, 1fr))`.
- Z-index: use existing scale (`--z-dropdown`, `--z-overlay`, `--z-modal`, ...). Several components hardcode arbitrary values (`z-index: 1000/9000/100`) instead of scale vars — don't add more; touching file with one, migrate to scale var.

## Motion

- Motion part of build, not afterthought — plan with component.
- Don't animate layout properties (`width`, `height`, `top`, `left`) unless no alternative; animate `transform`/`opacity`.
- Ease out with exponential curves (`ease-out-quart`/`quint`/`expo`). No bounce, no elastic.
- Every animation needs `@media (prefers-reduced-motion: reduce)` fallback (crossfade or instant). Canon currently has none — add whenever touch/add animated component, don't leave as gap.
- Staggering items in one list fine, often correct. Failure mode: identical uniform entrance slapped on every section regardless of content — not stagger/motion itself.
- Reveal animations must enhance already-visible default; never gate content visibility on class-triggered transition (breaks hidden tabs / non-visible renders).

## Interaction

- Dropdowns/popovers inside `overflow: hidden` or `overflow: auto` ancestor get clipped. Use `position: fixed`, native `<dialog>`/popover API, or portal to escape ancestor's stacking context. (See also WebKitGTK left-click-menu gotcha in `known-issues.md` — separate, already-fixed bug in `ContextMenu.tsx`, same family of overlay/positioning issue.)

## Absolute bans

Rewrite on sight, don't ship:

- Side-stripe borders (`border-left`/`border-right` >1px as colored accent on cards/list items/alerts). Use full borders, background tints, leading icons, or nothing.
- Gradient text (`background-clip: text` + gradient). Use solid color; emphasize via weight/size.
- Glassmorphism as default decorative choice. Rare and purposeful, or skip.
- Hero-metric template (big number + small label + gradient accent) — SaaS cliché, doesn't fit desktop music player anyway.
- Identical repeated card grids (icon + heading + text × N) as default section layout.
- Tiny uppercase tracked "eyebrow" label above every section.
- Numbered section markers (01/02/03) as default scaffolding — only legit for actual ordered sequence/process.
- Headings that overflow container. Check heading copy at each breakpoint app supports (window resizable); reduce clamp max or shorten copy if overflows.

## Product register

Canon product, not marketing surface — task UI (library browsing, tag editing, playback, settings). Bar isn't "would someone say AI made this," it's: would user fluent in Linear/Raycast/Spotify sit down and trust this, or pause at every subtly-off control? Failure mode here: strangeness without purpose (over-decorated buttons, gratuitous motion, invented affordances for standard tasks), not flatness. Earned familiarity — tool should disappear into task.

**Typography**
- One family carries everything: headings, labels, buttons, body, data. No display/body pairing.
- Fixed rem scale, not fluid `clamp()` — window resized by user, not viewed at varying DPI like marketing page.
- Tighter scale ratio (1.125–1.2 between steps).
- Prose still caps 65–75ch; dense UI (tables, tag lists) can run denser.

**Color**
- Restrained = floor: tinted neutrals + `--accent` used only for primary actions, current selection, state indicators. Never decoration.
- Standardize full state vocabulary per interactive element: hover, focus, active, disabled, selected, loading, error, warning, success, info. Don't leave states unstyled falling back to browser defaults.
- Sidebar/toolbar panels get distinct neutral layer from content surfaces (Canon already does via `--bg-elevated` vs `--bg-card` — reuse, don't invent third).

**Components**
- Every interactive component needs: default, hover, focus, active, disabled, loading, error. Shipping half these states not done.
- Skeleton states for loading, not spinners dropped mid-content.
- Empty states teach interface (e.g. "no albums yet — sync a server") instead of just "nothing here."
- Same button shape, same form-control vocabulary, same icon style across every view. Control looks different in two places = one wrong — fix it, don't add third variant.

**Motion**
- 150–250ms most transitions. User mid-task; don't make wait on choreography.
- Motion conveys state (change, feedback, loading, reveal) — never decoration.
- No orchestrated load sequences on view mount. App tool that gets used, not watched loading.

**Product-specific bans** (on top of shared absolute bans above)
- Decorative motion, no state meaning.
- Inconsistent component vocabulary across screens (two different "save" button styles, two different modal chrome treatments).
- Display fonts in labels, buttons, table data.
- Reinvented standard affordances for flavor (custom scrollbars, nonstandard `<select>` replacements, one-off modal chrome) — use platform/native conventions. Exception: checkboxes — Canon's custom `appearance: none` checkbox with accent-tinted fill + SVG checkmark (`src/App.css`, global `input[type="checkbox"]` rule) is the established app-wide style, user-confirmed 2026-07-14. Match it, don't revert to bare native checkboxes.
- Full-saturation accent color on inactive/disabled states.
- Modal as first reach. Try inline editing or progressive disclosure before modal — Canon already has several (`ArtistMergeModal`, `SmartPlaylistModal`, `IdentifyDialog`); don't add fourth pattern casually where inline affordance would do.

**What's fine here (don't over-correct against these)**
- System/familiar sans stacks — no custom display font needed.
- Standard nav patterns: sidebar + top bar, tabs (underline style per `coding-standards.md`), command palette.
- Density — tag lists, album grids, settings panels can be dense; don't pad for "breathing room" at cost of showing less.
- Consistency over surprise, screen to screen. Save delight/motion flourish for genuine moment (e.g. now-playing transitions), not every panel.

## The gut check

Someone screenshots it and immediately says "AI made this" = not done. Reason visually about the change before calling it finished — same standard applies full components, not just icon glyphs (`feedback-icon-button-verify.md`).

**Do NOT auto-launch the app or invoke browser automation (`run` skill, claude-in-chrome) to verify.** Ask user first if live visual verification wanted; don't self-trigger it as part of "done."