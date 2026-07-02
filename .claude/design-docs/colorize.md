> **Extra context needed**: existing brand colors.

Swap timid grayscale or single-accent design for strategic palette: pick color strategy, pick hue family fit brand, apply color with intent. More color ≠ better. Strategic color beat rainbow vomit.

---

## Register

Brand: palette IS voice. Pick color strategy first, follow its dosage:

- **Restrained**: tinted neutrals + one accent ≤10%. Product default; brand minimalism.
- **Committed**: one saturated color carries 30-60% of surface. Brand default for identity-driven pages.
- **Full palette**: 3-4 named roles, each used deliberately. Brand campaigns; product data viz.
- **Drenched**: surface IS the color. Brand heroes, campaign pages.

Committed, Full palette, Drenched deliberately exceed ≤10% rule; that rule Restrained only. Unexpected combos allowed; dominant color can own page when strategy calls for it.

Product: semantic-first, almost always Restrained. Accent color reserved for primary action, current selection, state indicators. Not decoration. Every color consistent meaning across every screen.

---

## Assess Color Opportunity

Analyze current state, find opportunities:

1. **Understand current state**:
   - **Color absence**: Pure grayscale? Limited neutrals? One timid accent?
   - **Missed opportunities**: Where could color add meaning, hierarchy, delight?
   - **Context**: What fit this domain and audience?
   - **Brand**: Existing brand colors to use?

2. **Identify where color add value**:
   - **Semantic meaning**: Success (green), error (red), warning (yellow/orange), info (blue)
   - **Hierarchy**: Draw attention to important elements
   - **Categorization**: Different sections, types, states
   - **Emotional tone**: Warmth, energy, trust, creativity
   - **Wayfinding**: Help users navigate, understand structure
   - **Delight**: Moments of visual interest, personality

Unclear from codebase? STOP, call AskUserQuestion tool to clarify.

**CRITICAL**: More color ≠ better. Strategic color beat rainbow vomit every time. Every color need purpose.

## Plan Color Strategy

Build purposeful color intro plan:

- **Color palette**: Colors match brand/context? (2-4 colors max beyond neutrals)
- **Dominant color**: Which owns 60% of colored elements?
- **Accent colors**: Which give contrast, highlights? (30% and 10%)
- **Application strategy**: Where each color appear, why?

**IMPORTANT**: Color enhance hierarchy and meaning, not create chaos. Less more when it matter more.

## Introduce Color Strategically

Add color systematic across these dimensions:

### Semantic Color
- **State indicators**:
  - Success: Green tones (emerald, forest, mint)
  - Error: Red/pink tones (rose, crimson, coral)
  - Warning: Orange/amber tones
  - Info: Blue tones (sky, ocean, indigo)
  - Neutral: Gray/slate for inactive states

- **Status badges**: Colored backgrounds/borders for states (active, pending, completed, etc.)
- **Progress indicators**: Colored bars, rings, charts show completion or health

### Accent Color Application
- **Primary actions**: Color most important buttons/CTAs
- **Links**: Add color to clickable text (keep accessibility)
- **Icons**: Colorize key icons for recognition, personality
- **Headers/titles**: Add color to section headers/key labels
- **Hover states**: Introduce color on interaction

### Background & Surfaces
- **Tinted backgrounds**: Replace pure gray → tint toward brand hue, not generic warm/cool pair. Default-warm-tint (`oklch(97% 0.01 60)` and neighbors) now AI cream/sand giveaway. Be specific to brand or stay neutral.
- **Colored sections**: Subtle background colors separate areas
- **Gradient backgrounds**: Add depth, subtle intentional gradients (not generic purple-blue)
- **Cards & surfaces**: Tint toward brand, not "for warmth" by reflex

**Use OKLCH for color**: perceptually uniform — equal lightness steps *look* equal. Great for harmonious scales.

### Data Visualization
- **Charts & graphs**: Color encode categories or values
- **Heatmaps**: Color intensity show density/importance
- **Comparison**: Color code different datasets/timeframes

### Borders & Accents
- **Hairline borders**: 1px colored border full perimeter (not side-stripes; see absolute ban `border-left/right > 1px`)
- **Underlines**: Color underlines for emphasis or active states
- **Dividers**: Subtle colored dividers instead of gray lines
- **Focus rings**: Colored focus indicators match brand
- **Surface tints**: 4-8% background wash of accent color instead of stripe

**NEVER**: `border-left` or `border-right` greater than 1px as colored accent stripe. One of three absolute bans in parent skill. Want mark card "active" or "warning"? Use full hairline border, background tint, leading glyph, or numbered prefix. Not side stripe.

### Typography Color
- **Colored headings**: Brand colors for section headings (keep contrast)
- **Highlight text**: Color for emphasis or categories
- **Labels & tags**: Small colored labels for metadata/categories

### Decorative Elements
- **Illustrations**: Add colored illustrations/icons
- **Shapes**: Geometric shapes in brand colors as background elements
- **Gradients**: Colorful gradient overlays or mesh backgrounds
- **Blobs/organic shapes**: Soft colored shapes for visual interest

## Balance & Refinement

Ensure color addition improve, not overwhelm:

### Maintain Hierarchy
- **Dominant color** (60%): Primary brand color or most used accent
- **Secondary color** (30%): Supporting color for variety
- **Accent color** (10%): High contrast for key moments
- **Neutrals** (remaining): Gray/black/white for structure

### Accessibility
- **Contrast ratios**: Ensure WCAG compliance (4.5:1 text, 3:1 UI components)
- **Don't rely on color alone**: Use icons, labels, patterns alongside color
- **Test color blindness**: Verify red/green combos work for all users

### Cohesion
- **Consistent palette**: Use colors from defined palette, not arbitrary
- **Systematic application**: Same color meanings throughout (green always = success)
- **Temperature consistency**: Warm palette stay warm, cool stay cool

**NEVER**:
- Use every rainbow color (choose 2-4 beyond neutrals)
- Apply color randomly, no semantic meaning
- Put gray text on colored backgrounds — looks washed out; use darker shade of background color or transparency instead
- Violate WCAG contrast requirements
- Use color as only indicator (accessibility issue)
- Make everything colorful (defeats purpose)
- Default to purple-blue gradients (AI slop aesthetic)

## Verify Color Addition

Test colorization improve experience:

- **Better hierarchy**: Color guide attention right?
- **Clearer meaning**: Color help users understand states/categories?
- **More engaging**: Interface feel warmer, inviting?
- **Still accessible**: All combos meet WCAG?
- **Not overwhelming**: Color balanced, purposeful?

Palette earns place → hand off to `/impeccable polish` for final pass.

## Live-mode signature params

Invoked from live mode: each variant MUST declare `color-amount` param so user dial between restrained accent and drenched surface without regen. Author variant CSS against `var(--p-color-amount, 0.5)`, typically alpha multiplier on backgrounds, or scaling factor on chroma axis in OKLCH expression. 0 = neutral/monochrome, 1 = full saturation/dominant coverage.

```json
{"id":"color-amount","kind":"range","min":0,"max":1,"step":0.05,"default":0.5,"label":"Color amount"}
```

Layer 1-2 variant-specific params on top: palette selection (`steps` with named options), temperature warmth, or tint vs. true color.

Param kinds: `range` (slider, drives `--p-<id>` CSS var), `steps` (segmented control, drives `data-p-<id>` attribute), `toggle` (on/off, drives both). Budget scales with composition size: leaf/tiny 0, small composition 0-1, medium 1-2, large composition 2-3 (hard cap 4).

---

## Reference Material

Sections below were previously `color-and-contrast.md`, live inline now so colorize flow has deep color reference in one place.

### Color & Contrast

#### Color Spaces: Use OKLCH

**Stop using HSL.** Use OKLCH (or LCH) instead. Perceptually uniform — equal lightness steps *look* equal, unlike HSL where 50% lightness yellow look bright, 50% blue look dark.

OKLCH function takes three components: `oklch(lightness chroma hue)` where lightness 0-100%, chroma roughly 0-0.4, hue 0-360. Build primary color + lighter/darker variants: hold chroma+hue roughly constant, vary lightness, but **reduce chroma near white or black** — high chroma at extreme lightness look garish.

Hue pick is brand decision, not default. Don't reach for blue (hue 250) or warm orange (hue 60) by reflex; those dominant AI-design defaults, not right answer for any specific brand.

#### Building Functional Palettes

##### Tinted Neutrals

**Pure gray dead.** Neutral with zero chroma feel lifeless next to colored brand. Add tiny chroma value (0.005-0.015) to all neutrals, hued toward brand color. Chroma small enough not read as "tinted" consciously, but create subconscious cohesion between brand color and UI surfaces.

Hue tint toward should come from THIS project's brand, not "warm = friendly, cool = tech" formula. Brand color teal → neutrals lean teal. Brand color amber → lean amber. Point: cohesion with SPECIFIC brand, not stock palette.

**Avoid** trap of always tinting warm orange or always cool blue. Two laziest defaults, create own monoculture across projects.

##### Palette Structure

Complete system need:

| Role | Purpose | Example |
|------|---------|---------|
| **Primary** | Brand, CTAs, key actions | 1 color, 3-5 shades |
| **Neutral** | Text, backgrounds, borders | 9-11 shade scale |
| **Semantic** | Success, error, warning, info | 4 colors, 2-3 shades each |
| **Surface** | Cards, modals, overlays | 2-3 elevation levels |

**Skip secondary/tertiary unless needed.** Most apps fine with one accent color. More colors = decision fatigue, visual noise.

##### The 60-30-10 Rule (Applied Correctly)

Rule about **visual weight**, not pixel count:

- **60%**: Neutral backgrounds, white space, base surfaces
- **30%**: Secondary colors: text, borders, inactive states
- **10%**: Accent: CTAs, highlights, focus states

Common mistake: use accent color everywhere cuz "brand color." Accent colors work *because* rare. Overuse kill their power.

#### Contrast & Accessibility

##### WCAG Requirements

| Content Type | AA Minimum | AAA Target |
|--------------|------------|------------|
| Body text | 4.5:1 | 7:1 |
| Large text (18px+ or 14px bold) | 3:1 | 4.5:1 |
| UI components, icons | 3:1 | 4.5:1 |
| Non-essential decorations | None | None |

##### Dangerous Color Combinations

Commonly fail contrast or cause readability issues:

- Light gray text on white (#1 accessibility fail)
- Red text on green background (or reverse): 8% men can't distinguish
- Blue text on red background (vibrates visually)
- Yellow text on white (almost always fail)
- Thin light text on images (unpredictable contrast)

##### Testing

Don't trust eyes. Use tools:

- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- Browser DevTools → Rendering → Emulate vision deficiencies
- [Polypane](https://polypane.app/) for real-time testing

#### Theming: Light & Dark Mode

##### Dark Mode Is Not Inverted Light Mode

Can't just swap colors. Dark mode need different design decisions:

| Light Mode | Dark Mode |
|------------|-----------|
| Shadows for depth | Lighter surfaces for depth (no shadows) |
| Dark text on light | Light text on dark (reduce font weight) |
| Vibrant accents | Desaturate accents slightly |
| White backgrounds | Either pure black or deep surface fit brand (brand-tinted near-black at oklch 12-18% works too) |

Dark mode: depth come from surface lightness, not shadow. Build 3-step surface scale, higher elevations lighter (e.g. 15% / 20% / 25% lightness). Use SAME hue and chroma as brand color (whatever for THIS project; don't reach for blue), only vary lightness. Reduce body text weight slightly (e.g. 350 instead of 400) — light text on dark read heavier than dark text on light.

##### Token Hierarchy

Use two layers: primitive tokens (`--blue-500`) and semantic tokens (`--color-primary: var(--blue-500)`). Dark mode: only redefine semantic layer; primitives stay same.

#### Alpha Is A Design Smell

Heavy transparency use (rgba, hsla) usually mean incomplete palette. Alpha create unpredictable contrast, performance overhead, inconsistency. Define explicit overlay colors per context instead. Exception: focus rings and interactive states where see-through needed.

---

**Avoid**: Relying on color alone to convey info. Creating palettes without clear roles per color. Skipping color blindness testing (8% of men affected).