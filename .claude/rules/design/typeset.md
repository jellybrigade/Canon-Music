Typography carries most of the information on a page.

Canon is **product register**: one well-tuned familiar sans carries the whole UI (headings, labels, buttons, data). Fixed `rem` scale, 1.125-1.2 ratio, closer-spaced steps. No fluid `clamp()` (kills the spatial predictability dense layouts need), no display/body pairing, no second family. System stacks (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui`) are legitimate here.

Font *selection* only matters if the existing identity is being replaced, which it isn't. If it ever is: pick from three concrete physical brand-voice words, browse a real catalog, and reject reflex defaults (Inter, DM Sans, Space Grotesk/Mono, IBM Plex, Fraunces, Playfair, Cormorant, Syne, Outfit, Plus Jakarta, Instrument, Newsreader, Lora, Crimson).

## Scale

5 roles cover it. Commit to one ratio.

| Role | Typical | Use |
|---|---|---|
| xs | 0.75rem | Captions, legal |
| sm | 0.875rem | Secondary UI, metadata |
| base | 1rem | Body |
| lg | 1.25-1.5rem | Subheadings, lead |
| xl+ | 2-4rem | Headlines |

Hierarchy combines size + weight + color + space; never size alone. Semantic tokens (`--text-body`, `--text-heading`), not value names.

## Readability

`max-width: 65ch` on prose containers (dense UI - tables, tag lists - can run denser). Line-height 1.1-1.2 headings, 1.5-1.7 body. Body min 1rem, never `px`. **Light-on-dark needs three compensations together** (Canon is dark): +0.05-0.1 line-height, +0.01-0.02em letter-spacing, consider one weight step up. Perceived weight drops on all three axes at once. Pick paragraph spacing OR indent, never both.

## Web fonts (only if one is ever added)

```css
@font-face { font-family: 'X'; src: url('x.woff2') format('woff2'); font-display: swap; }
@font-face { font-family: 'X-Fallback'; src: local('Arial'); size-adjust: 105%; ascent-override: 90%; descent-override: 20%; }
```
`swap` = FOUT; `optional` = zero shift but may never show the font. Preload only the body-regular weight. Variable font for 3+ weights.

## Polish

```css
body { font-kerning: normal; font-optical-sizing: auto; }
code { font-variant-ligatures: none; }
```
ALL-CAPS/small-caps labels need 0.05-0.12em letter-spacing.

## Accessibility

Never `user-scalable=no`. `rem`/`em` only for font sizes. 16px+ body. 44px+ tap targets via padding/line-height. Layout must survive 200% zoom (fix the layout, not the zoom).

## Bans

More than one family. No fallback definitions. Decorative/display fonts in body, labels, buttons, or table data. Sizes picked arbitrarily instead of from the scale.
