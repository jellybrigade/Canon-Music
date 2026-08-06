# Design Guidelines

Applies to `src/components/**`, `src/styles/**`. Ship production-grade: no unfinished states, no "good enough" spacing or contrast.

Layout/spacing/hierarchy rules live in `design/layout.md`, type rules in `design/typeset.md` (both auto-loaded). Read on demand from `.claude/design-docs/`: `interaction-design.md` (complex forms, modals, settings panels), `animate.md`, `colorize.md`, `adapt.md`, `clarify.md` (copy, empty states, errors).

## Design tokens

Never ship a raw literal (`opacity: 0.4`, `z-index: 1000`, `#1a1a1a`) where a token scale exists. Before writing any value:

1. `grep -rn "^\s*--<prefix>-" src/App.css src/styles/` for the token family (`--opacity-*`, `--space-*`, `--z-*`, `--duration-*`, `--tint-*`, `--radius-*`, `--shadow-*`).
2. Pick the closest value to the intended visual result, checking neighbors (`--opacity-40` vs `--opacity-45`), not just the first hit.
3. `grep -rn "var(--opacity-40)" src/` to see existing usage; matching a same-purpose site keeps consistency.
4. Genuinely nothing fits → add a token to the scale in `App.css` next to its siblings. Never inline a magic number, never invent a one-off var outside the scale.

## Color

Canon is dark, theme established in `src/styles/` (`--bg-card`, `--bg-elevated`, `--accent`). Reuse it; never introduce a second accent or off-brand hue.

- Body text ≥4.5:1, large text (≥18px, or bold ≥14px) ≥3:1. Placeholder text held to the body bar too, so not the default muted gray.
- Gray text on a colored background looks washed out. Use a darker shade of that background's own hue, or transparency of the text color.
- `--accent` only for primary actions, current selection, state indicators. Never decoration, never at full saturation on inactive/disabled.
- Sidebar/toolbar panels use `--bg-elevated`, content surfaces `--bg-card`. Don't invent a third layer.

## Motion

Plan it with the component, not after. 150-250ms for most transitions; the user is mid-task. Motion conveys state (change, feedback, loading, reveal), never decoration, and no orchestrated load sequences on mount.

Animate `transform`/`opacity`, not layout properties. Ease out with exponential curves (`ease-out-quart`/`quint`/`expo`); no bounce, no elastic. Every animation needs a `@media (prefers-reduced-motion: reduce)` fallback - Canon currently has none, so add one whenever touching an animated component. Reveal animations must enhance an already-visible default; never gate content visibility on a class-triggered transition (breaks hidden tabs).

Staggering one list is fine. The failure mode is the same entrance pasted onto every section.

## Components

Every interactive component ships default, hover, focus, active, disabled, loading, error (plus selected where it applies). Half of these is not done. Skeletons for loading, not spinners dropped mid-content. Empty states teach the interface ("no albums yet - sync a server"), not "nothing here". Same button shape, form-control vocabulary, and icon style across every view; a control that looks different in two places means one is wrong - fix it, don't add a third.

Dropdowns/popovers inside an `overflow: hidden|auto` ancestor get clipped. Use `position: fixed`, native `<dialog>`/popover, or a portal.

Z-index from the scale (`--z-dropdown`, `--z-overlay`, `--z-modal`). Some files hardcode `1000`/`9000`/`100`; migrate those when you touch them, don't add more.

## Bans (rewrite on sight)

- Side-stripe borders (colored `border-left`/`right` >1px on cards, list items, alerts).
- Gradient text (`background-clip: text`).
- Glassmorphism as a default decorative choice.
- Hero-metric template (big number + small label + gradient).
- Identical repeated card grids (icon + heading + text x N) as default layout; nested cards.
- Tiny uppercase tracked "eyebrow" labels above sections; 01/02/03 section markers outside a real ordered sequence.
- Headings that overflow their container at any window size the app supports.
- Reinvented standard affordances (custom scrollbars, replaced `<select>`, one-off modal chrome). **Exception:** the custom `appearance: none` checkbox in `src/App.css` is the app-wide style, user-confirmed 2026-07-14 - match it, don't revert to native.
- Modal as first reach. Try inline editing or progressive disclosure; Canon already has `ArtistMergeModal`, `SmartPlaylistModal`, `IdentifyDialog` and doesn't need a fourth pattern.

## What's fine (don't over-correct)

System sans stacks. Standard nav: sidebar + top bar, underline tabs (see `coding-standards.md`), command palette. Density - tag lists, album grids and settings panels can be dense; don't pad at the cost of showing less. Consistency over surprise; save flourish for a genuine moment like now-playing transitions.

## Gut check

Bar is not "would someone say AI made this", it's: would a user fluent in Linear/Raycast/Spotify trust this, or pause at every subtly-off control? The failure mode here is strangeness without purpose, not flatness. Reason visually about the change before calling it done, whole components included.

**Do NOT auto-launch the app or use browser automation to verify.** Ask the user first if live visual verification is wanted.
