Space is the most underused tool. Fix structure (monotone spacing, weak hierarchy, identical card grids), not surface.

Canon is **product register**: predictable grids, consistent density, familiar nav. Responsive behavior is structural (collapse sidebar, responsive table), not fluid type. Consistency IS affordance. `clamp()` fluid spacing is for marketing surfaces only, so not here.

## Spacing

4pt base (4, 8, 12, 16, 24, 32, 48, 64, 96). Values always from the defined set. Semantic tokens (`--space-xs`...`--space-xl`), never value names. `gap` for sibling spacing, not margins.

## Rhythm

Tight within a group (8-12px), generous between sections (48-96px). Vary spacing within a section; not every row gets the same gap.

## Tool choice

Flexbox for 1D (rows, nav, button groups, component internals). Grid for 2D (page structure, dashboards). Named grid areas for complex pages, redefined per breakpoint. Container queries for components, viewport queries for page layout:

```css
.card-container { container-type: inline-size; }
@container (min-width: 400px) { .card { grid-template-columns: 120px 1fr; } }
```

## Hierarchy

Fewest dimensions needed; space + weight alone often suffices. Best hierarchy stacks 2-3 at once (larger + bolder + more space above).

| Tool | Strong | Weak |
|---|---|---|
| Size | 3:1+ | <2:1 |
| Weight | Bold vs Regular | Medium vs Regular |
| Color | High contrast | Similar tones |
| Position | Top/left | Bottom/right |
| Space | Surrounded | Crowded |

Primary-action placement is contextual (bottom-right in dialogs, top in nav). Group via proximity + separation. Elevation: consistent subtle shadow scale, reinforcing hierarchy, not decoration.

## Optical adjustments

Nudge only when confident it looks wrong, never speculatively (play icons read off-center when geometrically centered). Tap targets 44x44 even when the visual is smaller:

```css
.icon-button { width: 24px; height: 24px; position: relative; }
.icon-button::before { content: ''; position: absolute; inset: -10px; }
```

## Bans

Arbitrary spacing off the scale. Uniform spacing everywhere. Wrapping everything in cards; nested cards. Identical repeated card grids as default section layout. Hero-metric template.

## Verify

Squint test still shows primary/secondary/groupings. Tight/generous beat present. Hierarchy obvious in 2s. Layout adapts across window sizes.
