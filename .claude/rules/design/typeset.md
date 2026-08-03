Typography carries most info on a page. Swap generic defaults (Inter, Roboto, system fallback flat scale) for type that reflects brand + scales with intentional contrast.

---

## Register

Brand: run font selection procedure below before picking type. Fluid `clamp()` scale, ≥1.25 ratio between steps.

Product: system fonts / familiar sans stacks legit. One well-tuned family usually carries the whole UI. Fixed `rem` scale, 1.125–1.2 ratio, closer-spaced steps.

## Font selection procedure (brand-register tasks — every project, never skip)

1. Write three concrete brand-voice words from the brief — physical-object words, not "modern"/"elegant" ("warm and mechanical and opinionated", "1970s terminal manual").
2. List three fonts you'd reach for by reflex. Any on the reject list below → reject; they're training-data defaults that create monoculture.
3. Browse a real catalog (Google Fonts, Pangram Pangram, Future Fonts, Adobe Fonts, ABC Dinamo, Klim, Velvetyne) with the three words in mind. Reject the first thing that "looks designy."
4. Cross-check: "elegant" isn't necessarily serif, "technical" isn't necessarily sans, "warm" isn't Fraunces. If the final pick matches your original reflex, start over.

**Reflex-reject list** (existing shipped brand identity wins over this — don't second-guess what's already live):
Fraunces · Newsreader · Lora · Crimson (Pro/Text) · Playfair Display · Cormorant (Garamond) · Syne · IBM Plex (Mono/Sans/Serif) · Space Mono · Space Grotesk · Inter · DM Sans/Serif Display/Serif Text · Outfit · Plus Jakarta Sans · Instrument Sans/Serif

**Anti-reflexes:** technical briefs don't need serif "for warmth" — tech tools should look like tech tools. Editorial/premium doesn't need the expressive serif everyone's using right now — Swiss-modern, neo-grotesque, literal monospace, quiet humanist all read premium. Kids' products don't need rounded display fonts — kids' books use real type. "Modern" doesn't mean geometric sans — the most modern move is often not using the font everyone else uses. System fonts (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui`) are underrated where performance > personality.

## Pairing

Often you don't need a second font — one family across multiple weights gives cleaner hierarchy than two competing typefaces. When you do pair, contrast on a real axis: serif+sans (structure), geometric+humanist (personality), condensed display+wide body (proportion). Never pair near-identical fonts (two geometric sans).

## Hierarchy & scale

5 sizes cover most needs — caption / secondary / body / subheading / heading. Consistent ratio (1.25, 1.333, or 1.5) — pick one, commit. Combine size + weight + color + space; don't rely on size alone.

| Role | Typical | Use |
|---|---|---|
| xs | 0.75rem | Captions, legal |
| sm | 0.875rem | Secondary UI, metadata |
| base | 1rem | Body |
| lg | 1.25–1.5rem | Subheadings, lead |
| xl+ | 2–4rem | Headlines, hero |

App UI: fixed `rem` scale, optional 1-2 breakpoint adjust — fluid sizing kills the spatial predictability dense container layouts need. Marketing/content: fluid `clamp(min, preferred, max)` for headings/display only, body stays fixed. Bound `clamp()` to `max ≤ ~2.5× min` — wider breaks zoom/reflow and makes large viewports feel like shouting. Scale container width + font-size together so measure stays 45-75ch across viewports.

## Readability

`max-width: 65ch` on text containers. Line-height: tighter headings (1.1-1.2), looser body (1.5-1.7). Body text min 16px/1rem, never `px` (respect user zoom). Light-on-dark text needs three compensations together, not one: bump line-height 0.05-0.1, add letter-spacing 0.01-0.02em, consider stepping body weight up one notch — perceived weight drops across all three axes at once so fix all three. Pick paragraph spacing OR first-line indent, never both (digital: spacing; editorial/long-form: indent-only can work).

## Web font loading

```css
@font-face {
  font-family: 'CustomFont';
  src: url('font.woff2') format('woff2');
  font-display: swap;
}
@font-face {
  font-family: 'CustomFont-Fallback';
  src: local('Arial');
  size-adjust: 105%;
  ascent-override: 90%;
  descent-override: 20%;
  line-gap-override: 10%;
}
body { font-family: 'CustomFont', 'CustomFont-Fallback', sans-serif; }
```

`swap` shows fallback immediately then FOUT-swaps; `optional` uses fallback if the web font misses a ~100ms budget (zero layout shift, but may never show the branded font on slow networks) — pick `optional` when zero shift matters more than branding. [Fontaine](https://github.com/unjs/fontaine) can calc the override values. Preload only the critical weight (usually body-regular) — preloading every weight costs more than it saves. Variable fonts for 3+ weights/styles (often smaller than the static files, gives fractional control, pairs with `font-optical-sizing: auto`); static is fine for 1-2 weights.

## Polish

```css
.recipe-amount { font-variant-numeric: diagonal-fractions; }
abbr { font-variant-caps: all-small-caps; }
code { font-variant-ligatures: none; }
body { font-kerning: normal; font-optical-sizing: auto; }
```
Check feature support at [Wakamai Fondue](https://wakamaifondue.com/). ALL-CAPS/small-caps labels: add 5-12% letter-spacing (`0.05em`-`0.12em`) — capitals sit too close at default spacing.

## System tokens

Semantic names (`--text-body`, `--text-heading`), not value names (`--font-size-16`).

## Accessibility

Never `user-scalable=no`. `rem`/`em` only for font sizes. 16px+ body. 44px+ tap targets on text links via padding/line-height. Layout must survive 200% zoom — fix the layout, not the zoom.

## Bans

More than 2-3 font families. No fallback font definitions. Ignoring FOUT/FOIT load performance. Decorative/display fonts for body text. Sizes picked arbitrarily instead of from a committed scale.

When type carries hierarchy on its own, hand off to `/impeccable polish`.

## Live-mode signature params

Every variant declares `scale` controlling hierarchy ratio — express font sizes via `calc(var(--p-scale, 1) * <base>)` or `clamp(min, calc(var(--p-scale, 1) * Npx), max)`.

```json
{"id":"scale","kind":"range","min":0.85,"max":1.3,"step":0.05,"default":1,"label":"Scale"}
```

Where a variant riffs on a specific pairing, expose it as a `steps` param (e.g. serif+sans vs mono+sans vs all-sans), branching scoped CSS via `:scope[data-p-pairing="X"]`. Param kinds: `range` (slider → `--p-<id>`), `steps` (segmented → `data-p-<id>`), `toggle` (both). Budget by composition size: leaf/tiny 0, small 0-1, medium 1-2, large 2-3 (hard cap 4).
