# Coding Standards

## Tabs: always underline, never pills

Ref impl: `src/components/TagsView.css` (`.tags-tab-btn`).

```css
.tab-btn {
  background: none;
  border: none;
  border-radius: 0;               /* explicit - kills browser default rounding */
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;            /* overlaps container's border-bottom */
  color: var(--text-secondary);
}
.tab-btn:hover { color: var(--text-primary); }
.tab-btn--active {
  color: var(--text-primary);     /* NOT accent - only the underline is accent */
  border-bottom-color: var(--accent);
}
```

Wrong: background/border-radius on the active tab; accent-colored text without an underline. Tab bar sits above the container's `border-bottom: 1px solid var(--border)`.

## No em or en dashes in `src/`

Never `—` (U+2014) or `–` (U+2013) anywhere under `src/`: UI strings, JSX text, code comments. Plain `-` only for real hyphenation.

Don't blind-replace with one character; rephrase per context:
- Sentence pause → comma, colon, or two sentences.
- Range (`10–20`, `Mon–Fri`) → "10 to 20", or plain `-` for compact version/port ranges.
- Comment bullet prefix → plain `-`.
- User-facing string → rephrase naturally. Highest priority, users see these.
