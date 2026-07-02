Typography carry most info on page. Swap generic defaults (Inter, Roboto, system fallback flat scale) for type that reflect brand + scale with intentional contrast.

---

## Register

Brand: run font selection procedure (see Font Selection & Pairing below) before picking type. Fluid `clamp()` scale, ≥1.25 ratio between steps.

Product: system fonts + familiar sans stacks legit here. One well-tuned family usually carries whole UI. Fixed `rem` scale, 1.125–1.2 ratio, closer-spaced steps.

---

## Assess Current Typography

Find what's weak/generic in current type:

1. **Font choices**:
   - Invisible defaults in use? (Inter, Roboto, Arial, Open Sans, system defaults)
   - Font match brand personality? (playful brand shouldn't use corporate typeface)
   - Too many font families? (more than 2-3 = mess)

2. **Hierarchy**:
   - Heading vs body vs caption tell apart at glance?
   - Sizes too close together? (14px, 15px, 16px = muddy hierarchy)
   - Weight contrast strong enough? (Medium vs Regular barely visible)

3. **Sizing & scale**:
   - Consistent type scale, or sizes arbitrary?
   - Body text meet min readability? (16px+)
   - Sizing strategy fit context? (Fixed `rem` scales for app UIs; fluid `clamp()` for marketing/content page headings)

4. **Readability**:
   - Line lengths comfortable? (45-75 chars ideal)
   - Line-height fit font + context?
   - Enough contrast text vs background?

5. **Consistency**:
   - Same elements styled same throughout?
   - Font weights consistent? (not bold one section, semibold another, same role)
   - Letter-spacing intentional or default everywhere?

**CRITICAL**: goal not "fancier" text. Goal: clearer, more readable, more intentional. Good typography invisible; bad typography distracting.

## Plan Typography Improvements

Check [Reference Material](#reference-material) below — scales, pairing, loading strategies.

Build systematic plan:

- **Font selection**: fonts need replace? What fit brand/context?
- **Type scale**: modular scale (e.g. 1.25 ratio), clear hierarchy
- **Weight strategy**: which weight for which role? (Regular body, Semibold labels, Bold headings, or fit)
- **Spacing**: line-heights, letter-spacing, margins between typographic elements

## Improve Typography Systematically

### Font Selection

If fonts need replace:
- Pick fonts reflecting brand personality
- Pair with genuine contrast (serif + sans, geometric + humanist), or single family multi weights
- Ensure web font load no layout shift (`font-display: swap`, metric-matched fallbacks)

### Establish Hierarchy

Build clear type scale:
- **5 sizes cover most needs**: caption, secondary, body, subheading, heading
- **Consistent ratio** between levels (1.25, 1.333, or 1.5)
- **Combine dimensions**: size + weight + color + space for strong hierarchy. Don't rely size alone
- **App UIs**: fixed `rem`-based type scale, optional 1-2 breakpoint adjust. Fluid sizing kills spatial predictability dense container-based layouts need
- **Marketing / content pages**: fluid sizing via `clamp(min, preferred, max)` for headings + display text. Body text stay fixed

### Fix Readability

- Set `max-width` on text containers with `ch` units (`max-width: 65ch`)
- Adjust line-height per context: tighter headings (1.1-1.2), looser body (1.5-1.7)
- Bump line-height slightly for light-on-dark text
- Body text min 16px / 1rem

### Refine Details

- Use `tabular-nums` for data tables + numbers needing align
- Apply proper `letter-spacing`: slightly open small caps/uppercase, default/tight large display text
- Use semantic token names (`--text-body`, `--text-heading`), not value names (`--font-16`)
- Set `font-kerning: normal`, consider OpenType features where fit

### Weight Consistency

- Define clear role per weight, stick to them
- No more than 3-4 weights (Regular, Medium, Semibold, Bold plenty)
- Load only weights actually used (each weight adds page load)

**NEVER**:
- Use more than 2-3 font families
- Pick sizes arbitrary; commit to scale
- Set body text below 16px
- Use decorative/display fonts for body text
- Disable browser zoom (`user-scalable=no`)
- Use `px` for font sizes; use `rem` to respect user settings
- Default to Inter/Roboto/Open Sans when personality matters
- Pair fonts similar but not identical (two geometric sans-serifs)

## Verify Typography Improvements

- **Hierarchy**: identify heading vs body vs caption instantly?
- **Readability**: body text comfortable in long passages?
- **Consistency**: same-role elements styled identically throughout?
- **Personality**: typography reflect brand?
- **Performance**: web fonts load efficient, no layout shift?
- **Accessibility**: text meet WCAG contrast ratios? Zoomable to 200%?

When type carry hierarchy on own, hand off to `/impeccable polish` for final pass.

## Live-mode signature params

Each variant MUST declare `scale` param controlling hierarchy ratio. Express all font sizes in variant's scoped CSS through `calc(var(--p-scale, 1) * <base>)` or, better, scale type ramp via `clamp(min, calc(var(--p-scale, 1) * Npx), max)`. Users slide subdued to commanding.

```json
{"id":"scale","kind":"range","min":0.85,"max":1.3,"step":0.05,"default":1,"label":"Scale"}
```

Where variant riffs on specific pairing, expose pairing choice as `steps` param (e.g. "serif display + sans body" vs. "mono display + sans body" vs. "all-sans"). Each branch route through `:scope[data-p-pairing="X"]` selectors in scoped CSS.

Param kinds: `range` (slider, drives `--p-<id>` CSS var), `steps` (segmented control, drives `data-p-<id>` attribute), `toggle` (on/off, drives both). Budget scales with composition size: leaf/tiny 0, small composition 0-1, medium 1-2, large composition 2-3 (hard cap 4).

---

## Reference Material

Sections below were previously `typography.md`, live inline now so typeset flow has deep typography reference one place. `bolder.md` also references this section.

### Typography

#### Classic Typography Principles

##### Vertical Rhythm

Line-height = base unit for ALL vertical spacing. Body text `line-height: 1.5` on `16px` type (= 24px) → spacing values multiples of 24px. Creates subconscious harmony; text + space share mathematical foundation.

##### Modular Scale & Hierarchy

Common mistake: too many font sizes too close together (14px, 15px, 16px, 18px...). Muddy hierarchy.

**Use fewer sizes, more contrast.** 5-size system covers most needs:

| Role | Typical Ratio | Use Case |
|------|---------------|----------|
| xs | 0.75rem | Captions, legal |
| sm | 0.875rem | Secondary UI, metadata |
| base | 1rem | Body text |
| lg | 1.25-1.5rem | Subheadings, lead text |
| xl+ | 2-4rem | Headlines, hero text |

Popular ratios: 1.25 (major third), 1.333 (perfect fourth), 1.5 (perfect fifth). Pick one, commit.

##### Readability & Measure

Use `ch` units for char-based measure (`max-width: 65ch`). Line-height scale inverse to line length: narrow columns need tighter leading, wide columns need more.

**Non-obvious**: Light text on dark bg needs compensate three axes, not one. Bump line-height 0.05–0.1, add touch letter-spacing (0.01–0.02em), optionally step body weight up one notch (regular → medium). Perceived weight drops across all three; fix all three.

**Paragraph rhythm**: pick space between paragraphs OR first-line indent. Never both. Digital usually want space; editorial/long-form can justify indent-only.

#### Font Selection & Pairing

**Font selection procedure** (brand-register tasks — every project, never skip):

1. Read brief. Write three concrete brand-voice words. Not "modern" or "elegant" — "warm and mechanical and opinionated" or "calm and clinical and careful." Physical-object words.
2. List three fonts you'd reach for by reflex. Any appear in reflex-reject list below → reject; training-data defaults, create monoculture.
3. Browse real catalog (Google Fonts, Pangram Pangram, Future Fonts, Adobe Fonts, ABC Dinamo, Klim, Velvetyne) with three words in mind. Find font as *physical object*: museum caption, 1970s terminal manual, fabric label, cheap-newsprint children's book, concert poster, receipt from mid-century diner. Reject first thing that "looks designy."
4. Cross-check. "Elegant" not necessarily serif. "Technical" not necessarily sans. "Warm" not Fraunces. Final pick line up with original reflex → start over.

**Reflex-reject list** — training-data defaults, ban list, look further:

Fraunces · Newsreader · Lora · Crimson · Crimson Pro · Crimson Text · Playfair Display · Cormorant · Cormorant Garamond · Syne · IBM Plex Mono · IBM Plex Sans · IBM Plex Serif · Space Mono · Space Grotesk · Inter · DM Sans · DM Serif Display · DM Serif Text · Outfit · Plus Jakarta Sans · Instrument Sans · Instrument Serif

Reflex-reject list applies to **new design choices**. Existing brand already committed to font/lane as part of identity → identity-preservation wins; variants on existing surface don't second-guess what's already shipping.

Rest of section below: anti-reflex corrections, system font use, pairing rules.

##### Anti-reflexes worth defending against

- Technical/utilitarian brief does NOT need serif "for warmth." Most tech tools should look like tech tools.
- Editorial/premium brief does NOT need same expressive serif everyone use right now. Premium can be Swiss-modern, neo-grotesque, literal monospace, quiet humanist sans.
- Children's product does NOT need rounded display font. Kids' books use real type.
- "Modern" brief does NOT need geometric sans. Most modern thing you can do: not use font everyone else use.

**System fonts underrated**: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui` look native, load instant, highly readable. Consider for apps where performance > personality.

##### Pairing Principles

**Non-obvious truth**: often don't need second font. One well-chosen family, multi weights, cleaner hierarchy than two competing typefaces. Add second font only when need genuine contrast (e.g. display headlines + body serif).

When pairing, contrast multi axes:
- Serif + Sans (structure contrast)
- Geometric + Humanist (personality contrast)
- Condensed display + Wide body (proportion contrast)

##### Web Font Loading

Layout shift problem: fonts load late, text reflow, users see content jump. Fix:

```css
/* 1. Use font-display: swap for visibility */
@font-face {
  font-family: 'CustomFont';
  src: url('font.woff2') format('woff2');
  font-display: swap;
}

/* 2. Match fallback metrics to minimize shift */
@font-face {
  font-family: 'CustomFont-Fallback';
  src: local('Arial');
  size-adjust: 105%;        /* Scale to match x-height */
  ascent-override: 90%;     /* Match ascender height */
  descent-override: 20%;    /* Match descender depth */
  line-gap-override: 10%;   /* Match line spacing */
}

body {
  font-family: 'CustomFont', 'CustomFont-Fallback', sans-serif;
}
```

Tools like [Fontaine](https://github.com/unjs/fontaine) calc these overrides auto.

**`swap` vs `optional`**: `swap` show fallback text immediate, FOUT-swap when web font arrive. `optional` use fallback if web font miss small load budget (~100ms), avoid shift entirely. Pick `optional` when zero layout shift matter more than seeing branded font on slow networks.

**Preload critical weight only**: typically regular-weight body font above fold. Preload every weight cost more bandwidth than saves.

**Variable fonts for 3+ weights/styles**: single variable font file usually smaller than three static weight files, gives fractional weight control, pairs well `font-optical-sizing: auto`. For 1–2 weights, static fine.

#### Modern Web Typography

##### Fluid Type

Fluid typography via `clamp(min, preferred, max)` scale text smooth with viewport. Middle value (e.g. `5vw + 1rem`) control scale rate (higher vw = faster scale). Add rem offset so no collapse to 0 on small screens.

**Use fluid type for**: headings + display text on marketing/content pages where text dominate layout, needs breathe across viewport sizes.

**Use fixed `rem` scales for**: App UIs, dashboards, data-dense interfaces. No major app design system (Material, Polaris, Primer, Carbon) use fluid type in product UI; fixed scales + optional breakpoint adjust give spatial predictability container-based layouts need. Body text also fixed even on marketing pages, size diff across viewports too small warrant it.

**Bound your clamp()**: keep `max-size ≤ ~2.5 × min-size`. Wider ratio break browser zoom/reflow behaviour, make large viewports feel like page shouting.

**Scale container width + font-size together** so effective char measure stay 45–75ch band every viewport. Heading widening faster than container drift out comfortable measure top end.

##### OpenType Features

Most devs don't know these exist. Use for polish:

```css
/* Proper fractions */
.recipe-amount { font-variant-numeric: diagonal-fractions; }

/* Small caps for abbreviations */
abbr { font-variant-caps: all-small-caps; }

/* Disable ligatures in code */
code { font-variant-ligatures: none; }

/* Enable kerning (usually on by default, but be explicit) */
body { font-kerning: normal; }
```

Check what features your font support at [Wakamai Fondue](https://wakamaifondue.com/).

##### Rendering polish

```css
/* Variable fonts: pick the right optical-size master automatically */
body { font-optical-sizing: auto; }
```

**ALL-CAPS tracking**: capitals sit too close default spacing. Add 5–12% letter-spacing (`letter-spacing: 0.05em` to `0.12em`) for short all-caps labels, eyebrows, small headings. Real small caps (via `font-variant-caps`) need same treatment, slightly gentler.

#### Typography System Architecture

Name tokens semantic (`--text-body`, `--text-heading`), not by value (`--font-size-16`). Include font stacks, size scale, weights, line-heights, letter-spacing in token system.

#### Accessibility Considerations

Beyond contrast ratios (well-documented already), consider:

- **Never disable zoom**: `user-scalable=no` breaks accessibility. Layout break at 200% zoom → fix layout.
- **Use rem/em for font sizes**: respects user browser settings. Never `px` for body text.
- **Min 16px body text**: smaller strains eyes, fails WCAG mobile.
- **Adequate touch targets**: text links need padding/line-height creating 44px+ tap targets.

---

**Avoid**: More than 2-3 font families per project. Skip fallback font definitions. Ignore font loading performance (FOUT/FOIT). Decorative fonts for body text.