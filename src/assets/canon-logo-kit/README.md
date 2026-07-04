# Canon logo kit

Mark: two staggered voices (dux and comes) — the minimal canon.
Wordmark: Manrope ExtraBold, tracking -0.03em, converted to outlines (no font dependency).

## Files
- canon-mark-*             symbol only (viewBox 92x52)
- canon-lockup-*           symbol + wordmark (viewBox 315.9x52, baseline-aligned)
- canon-wordmark-*         type only (viewBox 197.9x46)
- canon-app-icon*.svg      512x512 rounded tile
- canon-favicon.svg        64x64, auto light/dark via prefers-color-scheme
- canon-social-card.svg    1200x630 for og:image (render to PNG for meta tags)

## Variants
- black / white            fixed colors (#141414 / #f5f5f3)
- currentcolor             inherits CSS color — best for inline <svg> in your Nuxt components
- adaptive                 embeds a prefers-color-scheme media query — best for <img> and GitHub README
- accent-on-light/dark     lead voice in accent

## Swapping the accent
The accent is a placeholder. Replace everywhere with:
    sed -i 's/#E8590C/#YOURHEX/g' *.svg

## Notes
- og:image does not support SVG in most crawlers — export the card:
    rsvg-convert -w 1200 canon-social-card.svg > og.png  (or any SVG-to-PNG tool)
- Favicon: <link rel="icon" type="image/svg+xml" href="/canon-favicon.svg">
