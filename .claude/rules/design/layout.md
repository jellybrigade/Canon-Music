Space most underused design tool. Find layout's real problem (monotone spacing, weak hierarchy, identical card grids) — fix structure, not surface.

---

## Register

Brand: asymmetric compositions, fluid spacing via `clamp()`, intentional grid-breaking for emphasis. Rhythm via contrast: tight groupings + generous separations.

Product: predictable grids, consistent densities, familiar nav patterns. Responsive behavior structural (collapse sidebar, responsive table), not fluid typography. Consistency IS affordance.

---

## Assess Current Layout

Analyze what's weak in spatial design:

1. **Spacing**:
   - Consistent or arbitrary? (random padding/margin values)
   - All spacing same? (equal padding everywhere = no rhythm)
   - Related elements grouped tight, generous space between groups?

2. **Visual hierarchy**:
   - Squint test: blur eyes. Still spot most important element, second, clear groupings?
   - Hierarchy effective? (space + weight alone can suffice; current approach work?)
   - Whitespace guide eye to what matters?

3. **Grid & structure**:
   - Clear underlying structure, or random feel?
   - Identical card grids everywhere? (icon + heading + text, repeated endless)

4. **Rhythm & variety**:
   - Layout have visual rhythm? (alternating tight/generous)
   - Every section same structure? (monotonous repeat)
   - Intentional surprise/emphasis moments?

5. **Density**:
   - Too cramped? (no breathing room)
   - Too sparse? (excess whitespace, no purpose)
   - Density match content type? (data-dense UI = tighter spacing; marketing page = more air)

**CRITICAL**: Layout problems often root cause of "off" interfaces even when colors/fonts fine. Space is design material — use with intention.

## Plan Layout Improvements

Build systematic plan:

- **Spacing system**: consistent scale (framework's built-in like Tailwind, rem-based tokens, or custom). Values matter less than consistency.
- **Hierarchy strategy**: how space communicate importance?
- **Layout approach**: what structure fit content? Flex for 1D, Grid for 2D, named areas for complex page layouts.
- **Rhythm**: where tight vs generous?

## Improve Layout Systematically

### Establish a Spacing System

- Consistent spacing scale (Tailwind, rem tokens, custom — all work). What matters: values from defined set, not arbitrary numbers.
- Prefer 4pt base scale (4, 8, 12, 16, 24, 32, 48, 64, 96px) over 8pt; 8pt too coarse, you'll often need 12px between 8 and 16.
- Name tokens semantically if custom properties: `--space-xs` through `--space-xl`, not `--spacing-8`
- Use `gap` for sibling spacing instead of margins; kills margin collapse hacks
- Apply `clamp()` for fluid spacing that breathes on larger screens

### Create Visual Rhythm

- **Tight grouping** for related elements (8-12px between siblings)
- **Generous separation** between distinct sections (48-96px)
- **Varied spacing** within sections (not every row needs same gap)
- **Asymmetric compositions**: deliberate choice when content invites it (not default to chase)

### Choose the Right Layout Tool

- **Flexbox for 1D layouts**: rows of items, nav bars, button groups, card contents, most component internals.
- **Grid for 2D layouts**: page-level structure, dashboards, data-dense interfaces, anything rows AND columns need coordinated control.
- Named grid areas (`grid-template-areas`) for complex page layouts; redefine at breakpoints.
- **Container queries** for components, viewport queries for page layouts. Card in narrow sidebar stays compact while same card in main content expands auto:

```css
.card-container { container-type: inline-size; }
.card { display: grid; gap: var(--space-md); }
@container (min-width: 400px) {
  .card { grid-template-columns: 120px 1fr; }
}
```

### Break Card Grid Monotony

- Don't default to card grids for everything; spacing + alignment create visual grouping naturally
- Cards only when content truly distinct and actionable. Never nest cards inside cards
- Vary card sizes, span columns, or mix cards with non-card content to break repetition

### Strengthen Visual Hierarchy

- Use fewest dimensions needed for clear hierarchy. Space alone can suffice; generous whitespace around element draws eye. Some polished designs achieve rhythm with just space + weight. Add color/size contrast only when simpler means insufficient.
- Best hierarchy combines 2–3 dimensions at once. Heading larger, bolder, AND more space above reads as primary without trying:

| Tool | Strong Hierarchy | Weak Hierarchy |
|------|------------------|----------------|
| **Size** | 3:1 ratio or more | <2:1 ratio |
| **Weight** | Bold vs Regular | Medium vs Regular |
| **Color** | High contrast | Similar tones |
| **Position** | Top/left (primary) | Bottom/right |
| **Space** | Surrounded by white space | Crowded |

- Reading flow: LTR languages, eye scans top-left to bottom-right naturally, but primary action placement depends on context (e.g. bottom-right in dialogs, top in nav).
- Create clear content groupings via proximity + separation.

### Manage Depth & Elevation

- Build consistent shadow scale (sm → md → lg → xl); shadows subtle
- Elevation reinforces hierarchy, not decoration

### Optical Adjustments

- Icon visually off-center despite geometrically centered? Nudge it. Only if confident it actually looks wrong. Don't adjust speculatively.
- Text at `margin-left: 0` looks slight indented from letterform whitespace; negative margin (`-0.05em`) optically aligns. Geometrically centered glyphs often look off-center (play icons shift right, arrows shift toward direction).
- Touch targets 44×44px minimum even when visual element smaller. Expand hit area with padding or pseudo-element:

```css
.icon-button { width: 24px; height: 24px; position: relative; }
.icon-button::before {
  content: ''; position: absolute; inset: -10px;
}
```

**NEVER**:
- Arbitrary spacing values outside scale
- All spacing equal (variety creates hierarchy)
- Wrap everything in cards (not everything needs container)
- Nest cards inside cards (use spacing + dividers for hierarchy within)
- Identical card grids everywhere (icon + heading + text, repeated)
- Default to hero metric layout (big number, small label, stats, gradient) as template. If showing real user data, prominent metric can work — but display actual data, not decorative numbers.

## Verify Layout Improvements

- **Squint test**: spot primary, secondary, groupings with blurred vision?
- **Rhythm**: page have satisfying beat of tight and generous spacing?
- **Hierarchy**: most important content obvious within 2 seconds?
- **Breathing room**: layout feel comfortable, not cramped or wasteful?
- **Consistency**: spacing system applied uniformly?
- **Responsiveness**: layout adapt gracefully across screen sizes?

When rhythm and hierarchy land, hand off to `/impeccable polish` for final pass.

## Live-mode signature params

Each variant MUST declare `density` param. Drive all spacing tokens in variant's scoped CSS through `calc(var(--p-density, 1) * <base>)`: paddings, gaps, column widths. Users slide airy to packed, layout re-breathes, no regeneration.

```json
{"id":"density","kind":"range","min":0.6,"max":1.4,"step":0.05,"default":1,"label":"Density"}
```

For variants whose topology genuinely changes (stacked vs side-by-side, grid vs bento), use `steps` param whose scoped CSS branches via `:scope[data-p-structure="X"]`. One structure param + one density param = powerful combo; resist adding third.

```json
{"id":"structure","kind":"steps","default":"grid","label":"Structure","options":[
  {"value":"stacked","label":"Stacked"},
  {"value":"grid","label":"Grid"},
  {"value":"bento","label":"Bento"}
]}
```

Param kinds: `range` (slider, drives `--p-<id>` CSS var), `steps` (segmented control, drives `data-p-<id>` attribute), `toggle` (on/off, drives both). Budget scales with composition size: leaf/tiny 0, small composition 0-1, medium 1-2, large composition 2-3 (hard cap 4).