> **Extra context need**: target platform/device + usage context.

Adapt existing design to different context: different screen size, device, platform, use case. Trap: treat adaptation as scaling. Job: rethink experience for new context.

---

## Assess Adaptation Challenge

Understand what need adapting + why:

1. **Identify source context**:
   - Designed for what originally? (Desktop web? Mobile app?)
   - What assumptions made? (Large screen? Mouse input? Fast connection?)
   - What work well in current context?

2. **Understand target context**:
   - **Device**: Mobile, tablet, desktop, TV, watch, print?
   - **Input method**: Touch, mouse, keyboard, voice, gamepad?
   - **Screen constraints**: Size, resolution, orientation?
   - **Connection**: Fast wifi, slow 3G, offline?
   - **Usage context**: On-the-go vs desk, quick glance vs focused reading?
   - **User expectations**: What users expect on this platform?

3. **Identify adaptation challenges**:
   - What won't fit? (Content, navigation, features)
   - What won't work? (Hover states on touch, tiny touch targets)
   - What's inappropriate? (Desktop patterns on mobile, mobile patterns on desktop)

**CRITICAL**: Adaptation = rethink experience for new context, not scale pixels.

## Plan Adaptation Strategy

Build context-appropriate strategy:

### Mobile Adaptation (Desktop → Mobile)

**Layout Strategy**:
- Single column not multi-column
- Vertical stack not side-by-side
- Full-width components not fixed widths
- Bottom nav not top/side nav

**Interaction Strategy**:
- Touch targets 44x44px min (not hover-dependent)
- Swipe gestures where fit (lists, carousels)
- Bottom sheets not dropdowns
- Thumbs-first design (controls in thumb reach)
- Bigger tap areas, more spacing

**Content Strategy**:
- Progressive disclosure (don't show everything at once)
- Prioritize primary content (secondary in tabs/accordions)
- Shorter text
- Bigger text (16px min)

**Navigation Strategy**:
- Hamburger menu or bottom nav
- Reduce nav complexity
- Sticky headers for context
- Back button in nav flow

### Tablet Adaptation (Hybrid Approach)

**Layout Strategy**:
- Two-column layouts (not single or three-column)
- Side panels for secondary content
- Master-detail views (list + detail)
- Adaptive per orientation (portrait vs landscape)

**Interaction Strategy**:
- Support touch + pointer both
- Touch targets 44x44px but allow denser layout than phone
- Side nav drawers
- Multi-column forms where fit

### Desktop Adaptation (Mobile → Desktop)

**Layout Strategy**:
- Multi-column layouts (use horizontal space)
- Side nav always visible
- Multiple info panels at once
- Fixed widths + max-width constraints (don't stretch to 4K)

**Interaction Strategy**:
- Hover states for extra info
- Keyboard shortcuts
- Right-click context menus
- Drag and drop where helpful
- Multi-select with Shift/Cmd

**Content Strategy**:
- Show more info upfront (less progressive disclosure)
- Data tables, many columns
- Richer visualizations
- More detailed descriptions

### Print Adaptation (Screen → Print)

**Layout Strategy**:
- Page breaks at logical points
- Remove nav, footer, interactive elements
- Black and white (or limited color)
- Proper margins for binding

**Content Strategy**:
- Expand shortened content (show full URLs, hidden sections)
- Add page numbers, headers, footers
- Include metadata (print date, page title)
- Convert charts to print-friendly versions

### Email Adaptation (Web → Email)

**Layout Strategy**:
- Narrow width (600px max)
- Single column only
- Inline CSS (no external stylesheets)
- Table-based layouts (email client compat)

**Interaction Strategy**:
- Large obvious CTAs (buttons not text links)
- No hover states (unreliable)
- Deep links to web app for complex interactions

## Implement Adaptations

Apply changes systematic:

### Responsive Breakpoints

Pick right breakpoints:
- Mobile: 320px-767px
- Tablet: 768px-1023px
- Desktop: 1024px+
- Or content-driven breakpoints (where design breaks)

### Layout Adaptation Techniques

- **CSS Grid/Flexbox**: Reflow layouts auto
- **Container Queries**: Adapt per container, not viewport
- **`clamp()`**: Fluid sizing between min/max
- **Media queries**: Different styles per context
- **Display properties**: Show/hide elements per context

### Touch Adaptation

- Bump touch target size (44x44px min)
- More spacing between interactive elements
- Remove hover-dependent interactions
- Add touch feedback (ripples, highlights)
- Consider thumb zones (bottom easier reach than top)

### Content Adaptation

- Use `display: none` sparing (still downloads)
- Progressive enhancement (core content first, enhancements on bigger screens)
- Lazy load off-screen content
- Responsive images (`srcset`, `picture` element)

### Navigation Adaptation

- Transform complex nav to hamburger/drawer on mobile
- Bottom nav bar for mobile apps
- Persistent side nav on desktop
- Breadcrumbs on smaller screens for context

**IMPORTANT**: Test real devices. DevTools emulation helpful, not perfect.

**NEVER**:
- Hide core functionality on mobile (if matters, make work)
- Assume desktop = powerful device (consider accessibility, older machines)
- Use different IA across contexts (confusing)
- Break user expectations for platform (mobile users expect mobile patterns)
- Forget landscape orientation on mobile/tablet
- Use generic breakpoints blind (use content-driven)
- Ignore touch on desktop (many desktop devices touch-enabled)

## Verify Adaptations

Test thorough across contexts:

- **Real devices**: Test actual phones, tablets, desktops
- **Different orientations**: Portrait + landscape
- **Different browsers**: Safari, Chrome, Firefox, Edge
- **Different OS**: iOS, Android, Windows, macOS
- **Different input methods**: Touch, mouse, keyboard
- **Edge cases**: Very small screens (320px), very large screens (4K)
- **Slow connections**: Test throttled network

Adaptation feel native each context → hand off to `/impeccable polish` for final pass.

---

## Reference Material

Sections below were `responsive-design.md` before, now live inline so adapt flow keep deep responsive reference in one place.

### Responsive Design

#### Mobile-First: Write It Right

Start base styles for mobile, use `min-width` queries to layer complexity. Desktop-first (`max-width`) means mobile load unneeded styles first.

#### Breakpoints: Content-Driven

Don't chase device sizes; let content tell where to break. Start narrow, stretch till design breaks, add breakpoint there. Three breakpoints usually enough (640, 768, 1024px). Use `clamp()` for fluid values without breakpoints.

#### Detect Input Method, Not Just Screen Size

**Screen size don't tell input method.** Laptop with touchscreen, tablet with keyboard exist. Use pointer + hover queries:

```css
/* Fine pointer (mouse, trackpad) */
@media (pointer: fine) {
  .button { padding: 8px 16px; }
}

/* Coarse pointer (touch, stylus) */
@media (pointer: coarse) {
  .button { padding: 12px 20px; }  /* Larger touch target */
}

/* Device supports hover */
@media (hover: hover) {
  .card:hover { transform: translateY(-2px); }
}

/* Device doesn't support hover (touch) */
@media (hover: none) {
  .card { /* No hover state - use active instead */ }
}
```

**Critical**: Don't rely on hover for functionality. Touch users can't hover.

#### Safe Areas: Handle the Notch

Modern phones got notches, rounded corners, home indicators. Use `env()`:

```css
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

/* With fallback */
.footer {
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
```

**Enable viewport-fit** in meta tag:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

#### Responsive Images: Get It Right

##### srcset with Width Descriptors

```html
<img
  src="hero-800.jpg"
  srcset="
    hero-400.jpg 400w,
    hero-800.jpg 800w,
    hero-1200.jpg 1200w
  "
  sizes="(max-width: 768px) 100vw, 50vw"
  alt="Hero image"
>
```

**How it works**:
- `srcset` lists available images with actual widths (`w` descriptors)
- `sizes` tells browser how wide image display
- Browser picks best file per viewport width + device pixel ratio

##### Picture Element for Art Direction

Need different crops/compositions (not just resolutions):

```html
<picture>
  <source media="(min-width: 768px)" srcset="wide.jpg">
  <source media="(max-width: 767px)" srcset="tall.jpg">
  <img src="fallback.jpg" alt="...">
</picture>
```

#### Layout Adaptation Patterns

**Navigation**: Three stages: hamburger + drawer mobile, horizontal compact tablet, full with labels desktop. **Tables**: Transform to cards on mobile via `display: block` + `data-label` attributes. **Progressive disclosure**: Use `<details>/<summary>` for content that collapse on mobile.

#### Testing: Don't Trust DevTools Alone

DevTools device emulation useful for layout but miss:

- Actual touch interactions
- Real CPU/memory constraints
- Network latency patterns
- Font rendering differences
- Browser chrome/keyboard appearances

**Test on min**: One real iPhone, one real Android, tablet if relevant. Cheap Android phones reveal perf issues never seen on simulators.

---

**Avoid**: Desktop-first design. Device detection instead of feature detection. Separate mobile/desktop codebases. Ignoring tablet + landscape. Assuming all mobile devices powerful.