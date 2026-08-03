Space most underused design tool. Fix structure (monotone spacing, weak hierarchy, identical card grids), not surface.

---

## Register

Brand: asymmetric compositions, fluid spacing via `clamp()`, intentional grid-breaking for emphasis. Rhythm via contrast: tight groupings + generous separations.

Product: predictable grids, consistent densities, familiar nav patterns. Responsive behavior structural (collapse sidebar, responsive table), not fluid typography. Consistency IS affordance.

---

## Spacing system

- Consistent scale (Tailwind, rem tokens, custom — all fine). What matters: values from a defined set, never arbitrary.
- Prefer 4pt base (4, 8, 12, 16, 24, 32, 48, 64, 96px) over 8pt — 8pt too coarse, you'll often need 12 between 8 and 16.
- Semantic token names (`--space-xs`...`--space-xl`), not value names.
- `gap` for sibling spacing, not margins — kills margin-collapse hacks.
- `clamp()` for fluid spacing on brand/marketing surfaces only.

## Rhythm

- Tight grouping for related elements (8-12px between siblings).
- Generous separation between distinct sections (48-96px).
- Vary spacing within sections — not every row needs the same gap.
- Asymmetric compositions: deliberate choice when content invites it, never default.

## Layout tool choice

- Flexbox: 1D — rows, nav bars, button groups, card contents, most component internals.
- Grid: 2D — page-level structure, dashboards, anything needing coordinated rows AND columns.
- Named grid areas for complex page layouts, redefined per breakpoint.
- Container queries for components (card compact in sidebar, expanded in main content), viewport queries for page layout:

```css
.card-container { container-type: inline-size; }
.card { display: grid; gap: var(--space-md); }
@container (min-width: 400px) {
  .card { grid-template-columns: 120px 1fr; }
}
```

## Card grids

Not the default. Cards only when content is genuinely distinct and actionable; never nest cards. Vary sizes / span columns / mix cards with non-card content rather than repeating one icon+heading+text template.

## Visual hierarchy

Fewest dimensions needed for clarity — space + weight alone often suffices. Add color/size contrast only when that's insufficient. Best hierarchy combines 2-3 dimensions at once (larger + bolder + more space above = primary, without trying):

| Tool | Strong | Weak |
|------|--------|------|
| Size | 3:1+ | <2:1 |
| Weight | Bold vs Regular | Medium vs Regular |
| Color | High contrast | Similar tones |
| Position | Top/left (primary) | Bottom/right |
| Space | Surrounded by whitespace | Crowded |

Reading flow LTR: top-left → bottom-right, but primary action placement is contextual (bottom-right in dialogs, top in nav). Build groupings via proximity + separation.

## Elevation

Consistent shadow scale (sm → md → lg → xl), subtle. Reinforces hierarchy, not decoration.

## Optical adjustments

Nudge only when confident it looks wrong, never speculatively — e.g. play icons/arrows read as off-center when geometrically centered; text at `margin-left: 0` can want `-0.05em` to align with letterform whitespace. Touch targets 44×44px minimum even when the visual element is smaller:

```css
.icon-button { width: 24px; height: 24px; position: relative; }
.icon-button::before { content: ''; position: absolute; inset: -10px; }
```

## Bans

- Arbitrary spacing outside the scale.
- Uniform spacing everywhere (no rhythm).
- Wrapping everything in cards; nesting cards.
- Identical repeated card grids as default section layout.
- Hero-metric template (big number + small label + gradient) unless showing real user data.

## Verify

Squint test (blurred vision still shows primary/secondary/groupings), rhythm (tight/generous beat), hierarchy obvious in 2s, breathing room without waste, spacing scale applied uniformly, layout adapts across sizes.

Once rhythm/hierarchy land, hand off to `/impeccable polish`.

## Live-mode signature params

Every variant declares `density`. Drive all spacing tokens through `calc(var(--p-density, 1) * <base>)`.

```json
{"id":"density","kind":"range","min":0.6,"max":1.4,"step":0.05,"default":1,"label":"Density"}
```

Variants whose topology genuinely changes (stacked vs side-by-side, grid vs bento) get a `steps` param branching scoped CSS via `:scope[data-p-structure="X"]`:

```json
{"id":"structure","kind":"steps","default":"grid","label":"Structure","options":[
  {"value":"stacked","label":"Stacked"},
  {"value":"grid","label":"Grid"},
  {"value":"bento","label":"Bento"}
]}
```

Param kinds: `range` (slider → `--p-<id>`), `steps` (segmented control → `data-p-<id>`), `toggle` (on/off, drives both). Budget by composition size: leaf/tiny 0, small 0-1, medium 1-2, large 2-3 (hard cap 4).
