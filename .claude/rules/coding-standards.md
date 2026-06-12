# Coding Standards

## UI Patterns

### Tab navigation

**Always use the underline style. Never use pills or backgrounds on active tabs.**

Reference implementation: `src/components/TagsView.css` (`.tags-tab-btn` / `.tags-tab-btn--active`).

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

The tab bar sits above a `border-bottom: 1px solid var(--border)` rule on the container.
Active tab's `margin-bottom: -1px` makes its 2px bottom border overlap and visually replace the container border.
