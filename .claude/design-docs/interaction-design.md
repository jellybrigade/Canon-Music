# Interaction Design

## The Eight Interactive States

Every interactive element need these states designed:

| State | When | Visual Treatment |
|-------|------|------------------|
| **Default** | At rest | Base styling |
| **Hover** | Pointer over (not touch) | Subtle lift, color shift |
| **Focus** | Keyboard/programmatic focus | Visible ring (see below) |
| **Active** | Being pressed | Pressed in, darker |
| **Disabled** | Not interactive | Reduced opacity, no pointer |
| **Loading** | Processing | Spinner, skeleton |
| **Error** | Invalid state | Red border, icon, message |
| **Success** | Completed | Green check, confirmation |

**Common miss**: Design hover without focus, or vice versa. Different states. Keyboard users never see hover.

## Focus Rings: Do Right

**Never `outline: none` without replacement.** Accessibility violation. Use `:focus-visible` — show focus only for keyboard users:

```css
/* Hide focus ring for mouse/touch */
button:focus {
  outline: none;
}

/* Show focus ring for keyboard */
button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

**Focus ring design**:
- High contrast (3:1 min against adjacent colors)
- 2-3px thick
- Offset from element (not inside)
- Consistent across all interactive elements

## Form Design: Non-Obvious Part

**Placeholders aren't labels.** Disappear on input. Always use visible `<label>` elements. **Validate on blur**, not every keystroke (exception: password strength). Errors go **below** fields, `aria-describedby` connect them.

## Loading States

**Optimistic updates**: Show success immediately, rollback on failure. Use for low-stakes actions (likes, follows), not payments or destructive actions. **Skeleton screens > spinners**: preview content shape, feel faster than generic spinners.

## Modals: Inert Approach

Focus trapping in modals used need complex JavaScript. Now use `inert` attribute:

```html
<!-- When modal is open -->
<main inert>
  <!-- Content behind modal can't be focused or clicked -->
</main>
<dialog open>
  <h2>Modal Title</h2>
  <!-- Focus stays inside modal -->
</dialog>
```

Or use native `<dialog>` element:

```javascript
const dialog = document.querySelector('dialog');
dialog.showModal();  // Opens with focus trap, closes on Escape
```

## The Popover API

For tooltips, dropdowns, non-modal overlays, use native popovers:

```html
<button popovertarget="menu">Open menu</button>
<div id="menu" popover>
  <button>Option 1</button>
  <button>Option 2</button>
</div>
```

**Benefits**: Light-dismiss (click outside closes), proper stacking, no z-index wars, accessible by default.

## Dropdown & Overlay Positioning

Dropdowns rendered `position: absolute` inside container with `overflow: hidden` or `overflow: auto` get clipped. Most common dropdown bug in generated code.

### CSS Anchor Positioning

Modern fix: CSS Anchor Positioning API tethers overlay to trigger, no JS:

```css
.trigger {
  anchor-name: --menu-trigger;
}

.dropdown {
  position: fixed;
  position-anchor: --menu-trigger;
  position-area: block-end span-inline-end;
  margin-top: 4px;
}

/* Flip above if no room below */
@position-try --flip-above {
  position-area: block-start span-inline-end;
  margin-bottom: 4px;
}
```

Dropdown uses `position: fixed` → escapes ancestor `overflow` clipping. `@position-try` block handles viewport edges auto. **Browser support**: Chrome 125+, Edge 125+. Not yet Firefox/Safari — need fallback.

### Popover + Anchor Combo

Popover API + anchor positioning together: stacking, light-dismiss, accessibility, correct position — one pattern:

```html
<button popovertarget="menu" class="trigger">Open</button>
<div id="menu" popover class="dropdown">
  <button>Option 1</button>
  <button>Option 2</button>
</div>
```

`popover` attribute puts element in **top layer** — sits above all content regardless z-index/overflow. No portal need.

### Portal / Teleport Pattern

In component frameworks, render dropdown at document root, position via JS:

- **React**: `createPortal(dropdown, document.body)`
- **Vue**: `<Teleport to="body">`
- **Svelte**: Use portal library or mount to `document.body`

Calc position from trigger's `getBoundingClientRect()`, apply `position: fixed` with `top`/`left`. Recalc on scroll and resize.

### Fixed Positioning Fallback

For browsers no anchor positioning support: `position: fixed` + manual coords avoids overflow clipping:

```css
.dropdown {
  position: fixed;
  /* top/left set via JS from trigger's getBoundingClientRect() */
}
```

Check viewport bounds before render. Dropdown overflow bottom edge → flip above trigger. Overflow right edge → align to trigger's right side.

## Destructive Actions: Undo > Confirm

**Undo beats confirmation dialogs.** Users click through confirms mindlessly. Remove from UI immediately, show undo toast, actually delete after toast expires. Confirmation only for truly irreversible actions (account deletion), high-cost actions, or batch ops.

## Keyboard Navigation Patterns

### Roving Tabindex

For component groups (tabs, menu items, radio groups): one item tabbable, arrow keys move within:

```html
<div role="tablist">
  <button role="tab" tabindex="0">Tab 1</button>
  <button role="tab" tabindex="-1">Tab 2</button>
  <button role="tab" tabindex="-1">Tab 3</button>
</div>
```

Arrow keys move `tabindex="0"` between items. Tab moves to next component entirely.

### Skip Links

Give skip links (`<a href="#main-content">Skip to main content</a>`) for keyboard users jump past nav. Hide off-screen, show on focus.

## Gesture Discoverability

Swipe-to-delete and similar gestures invisible. Hint at existence:

- **Partially reveal**: Show delete button peeking from edge
- **Onboarding**: Coach marks on first use
- **Alternative**: Always give visible fallback (menu with "Delete")

Don't rely on gestures as only action path.

---

**Avoid**: Removing focus indicators without alternatives. Placeholder text as labels. Touch targets <44x44px. Generic error messages. Custom controls without ARIA/keyboard support.