> **Additional context needed**: performance constraints.

Add motion that convey state, give feedback, clarify hierarchy. Cut motion that exist only for decoration. Animation fatigue real cost; spend budget on moments that need it.

---

## Register

Brand: motion part of voice; one well-rehearsed entrance beats scattered micro-interactions. Saturated AI default: fade-and-rise reveals on every scrolled section — that's tell, not choreography. Reserve scroll-triggered motion for moments that earn it.

Product: 150–250 ms on most transitions. Motion convey state: feedback, reveal, loading, transitions between views. No page-load choreography; users in task, won't wait for it.

---

## Assess Animation Opportunities

Analyze where motion improve experience:

1. **Identify static areas**:
   - **Missing feedback**: Actions without visual acknowledgment (button clicks, form submission, etc.)
   - **Jarring transitions**: Instant state changes feel abrupt (show/hide, page loads, route changes)
   - **Unclear relationships**: Spatial or hierarchical relationships not obvious
   - **Lack of delight**: Functional but joyless interactions
   - **Missed guidance**: Opportunities to direct attention or explain behavior

2. **Understand context**:
   - Personality? (Playful vs serious, energetic vs calm)
   - Performance budget? (Mobile-first? Complex page?)
   - Audience? (Motion-sensitive users? Power users who want speed?)
   - What matters most? (One hero animation vs many micro-interactions?)

If any unclear from codebase, STOP, call AskUserQuestion tool to clarify.

**CRITICAL**: Respect `prefers-reduced-motion`. Always provide non-animated alternatives for users who need them.

## Plan Animation Strategy

Create purposeful animation plan:

- **Hero moment**: ONE signature animation? (Page load? Hero section? Key interaction?)
- **Feedback layer**: Which interactions need acknowledgment?
- **Transition layer**: Which state changes need smoothing?
- **Delight layer**: Where surprise and delight?

**IMPORTANT**: One well-orchestrated experience beats scattered animations everywhere. Focus on high-impact moments.

## Implement Animations

Add motion systematically across these categories:

### Entrance Animations
- **Hero section**: Dramatic entrance for primary content (scale, parallax, or creative effects)
- **Modal/drawer entry**: Smooth slide + fade, backdrop fade, focus management
- **List rhythm**: Sibling stagger legit for cards-in-a-grid or list-items-appearing. Whole-section fade-on-scroll not list, not legit. Cap total stagger time: 10 items at 50ms each = 500ms total. More items → reduce per-item delay or cap staggered count.

  Use CSS custom properties for clean stagger: `animation-delay: calc(var(--i, 0) * 50ms)` with `style="--i: 0"`, `style="--i: 1"`, etc. on each item.

### Micro-interactions
- **Button feedback**:
  - Hover: Subtle scale (1.02-1.05), color shift, shadow increase
  - Click: Quick scale down then up (0.95 → 1), ripple effect
  - Loading: Spinner or pulse state
- **Form interactions**:
  - Input focus: Border color transition, slight scale or glow
  - Validation: Shake on error, check mark on success, smooth color transitions
- **Toggle switches**: Smooth slide + color transition (200-300ms)
- **Checkboxes/radio**: Check mark animation, ripple effect
- **Like/favorite**: Scale + rotation, particle effects, color transition

### State Transitions
- **Show/hide**: Fade + slide (not instant), appropriate timing (200-300ms)
- **Expand/collapse**: Height transition with overflow handling, icon rotation
- **Loading states**: Skeleton screen fades, spinner animations, progress bars
- **Success/error**: Color transitions, icon animations, gentle scale pulse
- **Enable/disable**: Opacity transitions, cursor changes

### Navigation & Flow
- **Page transitions**: Crossfade between routes, shared element transitions
- **Tab switching**: Slide indicator, content fade/slide
- **Carousel/slider**: Smooth transforms, snap points, momentum
- **Scroll effects**: Parallax layers, sticky headers with state changes, scroll progress indicators

### Feedback & Guidance
- **Hover hints**: Tooltip fade-ins, cursor changes, element highlights
- **Drag & drop**: Lift effect (shadow + scale), drop zone highlights, smooth repositioning
- **Copy/paste**: Brief highlight flash on paste, "copied" confirmation
- **Focus flow**: Highlight path through form or workflow

### Delight Moments
- **Empty states**: Subtle floating animations on illustrations
- **Completed actions**: Confetti, check mark flourish, success celebrations
- **Easter eggs**: Hidden interactions for discovery
- **Contextual animation**: Weather effects, time-of-day themes, seasonal touches

## Technical Implementation

Use appropriate techniques for each animation:

### Timing & Easing

**Duration: 100/300/500 rule.** Timing matters more than easing for "feels right":

| Duration | Use Case | Examples |
|----------|----------|----------|
| **100–150ms** | Instant feedback | Button press, toggle, color change |
| **200–300ms** | State changes | Menu open, tooltip, hover state |
| **300–500ms** | Layout changes | Accordion, modal, drawer |
| **500–800ms** | Entrance animations | Page load, hero reveal |

**Easing curves (use these, not CSS defaults):**
```css
/* Recommended: natural deceleration */
--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);    /* Smooth */
--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);   /* Slightly snappier */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);     /* Confident, decisive */

/* AVOID: feel dated and tacky */
/* bounce: cubic-bezier(0.34, 1.56, 0.64, 1); */
/* elastic: cubic-bezier(0.68, -0.6, 0.32, 1.6); */
```

**Exit animations faster than entrances.** Use ~75% of enter duration.

### CSS Animations
```css
/* Prefer for simple, declarative animations */
- transitions for state changes
- @keyframes for complex sequences
- transform and opacity for reliable movement
- blur, filters, masks, clip paths, shadows, and color shifts for premium atmospheric effects when verified smooth
```

### JavaScript Animation
```javascript
/* Use for complex, interactive animations */
- Web Animations API for programmatic control
- Framer Motion for React
- GSAP for complex sequences
```

### Motion Materials

Transform and opacity reliable defaults, not whole palette. Premium interfaces often need atmospheric properties. Match material to effect:

- **Transform / opacity**: movement, press feedback, simple reveals, list choreography
- **Blur / filter / backdrop-filter**: focus pulls, depth, glass or lens effects, softened entrances
- **Clip-path / masks**: wipes, reveals, editorial cropping, product-like transitions
- **Shadow / glow / color filters**: energy, affordance, focus, warmth, active state
- **Grid-template-rows or FLIP-style transforms**: expanding and reflowing layout without animating `height` directly

Hard rule isn't "transform and opacity only." It's: avoid animating layout-driving properties casually (`width`, `height`, `top`, `left`, margins), keep expensive effects bounded to small or isolated areas, verify smoothness in-browser on target viewports.

### Performance
- **Layout safety**: Avoid casual animation of layout-driving properties (`width`, `height`, `top`, `left`, margins)
- **will-change**: Add sparingly for known expensive animations only (e.g. on `:hover` or an `.animating` class), never preemptively across whole page
- **Scroll triggers**: Use Intersection Observer instead of scroll event listeners; unobserve after animation fires once
- **Bound expensive effects**: Keep blur/filter/shadow areas small or isolated, use `contain` where appropriate
- **Monitor FPS**: Ensure 60fps on target devices

### Perceived Performance

Nobody cares how fast site *is*, only how fast it feels. 80ms threshold: anything under ~80ms feels instant — brain buffers sensory input that long to synchronize perception. Target this for micro-interactions.

- **Preemptive start**: Begin transitions immediately while loading (iOS app zoom, skeleton UI). Users perceive work happening.
- **Early completion**: Show content progressively, don't wait for everything (progressive images, streaming HTML, skeleton fade-ins).
- **Optimistic UI**: Update interface immediately, handle failures gracefully. Use for low-stakes actions (likes, follows). Avoid for payments or destructive operations.
- **Easing affects perceived duration**: Ease-in (accelerating toward completion) makes tasks feel shorter — peak-end effect weights final moments heavily. Ease-out feels satisfying for entrances.
- **Caution**: Too-fast responses can decrease perceived value for complex operations (search, analysis). Sometimes brief delay signals "real work" happening.

### Accessibility
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**NEVER**:
- Use bounce or elastic easing curves; feel dated, draw attention to animation itself
- Animate layout properties casually (`width`, `height`, `top`, `left`, margins) when transform, FLIP, or grid-based techniques would work
- Use durations over 500ms for feedback (feels laggy)
- Animate without purpose (every animation needs reason)
- Ignore `prefers-reduced-motion` (accessibility violation)
- Animate everything (animation fatigue makes interfaces feel exhausting)
- Block interaction during animations unless intentional

## Verify Quality

Test animations thoroughly:

- **Smooth at 60fps**: No jank on target devices
- **Feels natural**: Easing curves feel organic, not robotic
- **Appropriate timing**: Not too fast (jarring) or too slow (laggy)
- **Reduced motion works**: Animations disabled or simplified appropriately
- **Doesn't block**: Users can interact during/after animations
- **Adds value**: Makes interface clearer or more delightful

When motion clarifies state instead of decorating it, hand off to `/impeccable polish` for final pass.