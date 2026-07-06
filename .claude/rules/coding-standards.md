# Coding Standards

## UI Patterns

### Tab navigation

**Always underline style. Never pills/backgrounds on active tabs.**

Ref impl: `src/components/TagsView.css` (`.tags-tab-btn` / `.tags-tab-btn--active`).

```css
/* ✓ correct */
.tab-btn {
  background: none;
  border: none;
  border-radius: 0;               /* explicit — kills browser default rounding */
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--text-secondary);
}
.tab-btn:hover { color: var(--text-primary); }
.tab-btn--active {
  color: var(--text-primary);     /* NOT accent — only the underline is accent */
  border-bottom-color: var(--accent);
}

/* ✗ wrong — pill style */
.tab-btn--active {
  background: var(--accent);
  border-radius: 6px;
  color: white;
}

/* ✗ wrong — colored text without underline */
.tab-btn--active {
  color: var(--accent);
}
```

Tab bar sits above container's `border-bottom: 1px solid var(--border)`.
Active tab `margin-bottom: -1px` → 2px bottom border overlap, replaces container border visually.

## No em dashes or en dashes

Never write `—` (em dash, U+2014) or `–` (en dash, U+2013) anywhere in `src/` — UI strings, JSX text, code comments, all of it. Plain hyphen `-` only for actual hyphenation/ranges.

Don't blind-regex-replace with one character everywhere — rephrase per context:

- Sentence-joining pause (`"X — meaning Y"`) → comma, colon, or split into two sentences.
- Numeric/date range (`"10–20"`, `"Mon–Fri"`) → `"10 to 20"`, or a plain hyphen if it's a compact version/port range.
- List-bullet prefix in a comment → plain hyphen `-`, or restructure.
- Code comment explaining a bug/workaround → rephrase naturally, keep technical content intact.
- User-facing UI string (JSX text, template literal shown to user) → rephrase naturally; these are highest priority, users see them directly.