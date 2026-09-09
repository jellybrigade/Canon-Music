---
description: Known UI bugs already shipped once - full detail
globs:
  - "src/components/**"
  - "src/app/**"
  - "src/**/*.css"
---

# UI

Bug classes that already shipped once. Heading = lesson. Greps kept, forensics in git.
Fixed unless marked OPEN.

- **Window-level `preventDefault` shortcut needs per-branch focus guard.** Ctrl+K/Ctrl+F/Escape each need different exemptions; `suspended` flag driven by one shared `overlayAbove`, not per-consumer bools. Exemption: Alt+Arrow in text fields (commented why).
  ```
  grep -rn "addEventListener(\"keydown\"" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Overlay's own Escape answers "am I open", not "am I on top".** No `stopPropagation` - registration order saves nothing. Fix: `useSearchShortcuts` takes `overlayAbove`.
  ```
  grep -rn 'e\.key === "Escape"' src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Hand-kept stacking list only covers what its author saw.** Several modals hand-rolled Escape instead of `useModalChrome`'s registry (`useAnyModalOpen()`), broke topmost-only rule. Menus/dropdowns must NOT register.
  ```
  grep -rln "createPortal" src/components --include='*.tsx' | grep -v '\.test\.' | xargs grep -Ln "useModalChrome"
  grep -rn "backdrop\|overlay" src/components --include='*.tsx' | grep -v '\.test\.' | grep "onClick={(e)\|onMouseDown={(e)"
  ```
  ```
  grep -rln "createPortal" src/components --include='*.tsx' | xargs grep -Ln "useModalChrome"
  ```
- **Backdrop `click` dismiss fires on a gesture that only ended there.** Fix: `useOverlayDismiss` arms `mousedown` at backdrop, closes only if release matches. Target identity, never `stopPropagation`.
  ```
  grep -rn "onClick={(e) => e.stopPropagation()}" src --include='*.tsx' | grep -v '\.test\.'
  ```
- **`Number(x) || fallback` deletes a legal zero.** Kills any `Math.max` floor beside it. Branch on `""` explicitly, then clamp.
  ```
  grep -rn "Number(.*)\s*||\|parseInt(.*)\s*||\|parseFloat(.*)\s*||" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Non-URL render state must be dismissed by navigation intent, not pathname change.** Overlays-as-state stayed painted when target route == current pathname. Fix: `useAppNavigation` runs `dismissOverlays` top of every nav call via ref.
  ```
  grep -rn "useNavigate()" src --include='*.ts*' | grep -v '\.test\.' | grep -v useAppNavigation
  ```
- **Dismissal at same priority as its navigation can't land first.** `dismissOverlays` in `startTransition` shared Suspense boundary with route's lazy import - overlay stayed painted during chunk download. Fix: keep dismissal urgent.
  ```
  grep -rn "startTransition" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **`null` for "don't know yet" and "isn't there" paints the same blank page.** `data ?? null` collapses `useQuery`'s pending distinction. Name the pending state.
  ```
  grep -rn "data:.*\} = useQuery" src/app --include='*.tsx' | grep -v '\.test\.'
  ```
- **Prerequisite gate is a state machine too; confident-wrong beats blank-wrong, but both are wrong.** 8 browse routes drifted into 3 wrong messages (told user to add a server they already have, stuck "Loading...", blank `<main>`). Fix: shared `CredentialNotice`/`CredentialGate`, pending vs failed vs absent.
  ```
  grep -rn "if (!serverWithCred\|if (!credential\|if (!server)\|if (!session" src --include='*.tsx' | grep -v '\.test\.'
  grep -rn "serverWithCred ?" src --include='*.tsx' | grep -v '\.test\.'
  ```
- **Decoding an already-decoded value = no-op or crash.** react-router decodes params once; second decode threw `URIError` or silently mangled `%20`. Test via real router (`src/lib/routes.router.test.tsx`). Known limit: literal `%2F` in name can't round-trip.
  ```
  grep -rn "decodeURIComponent\|unescape(" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Partial opt-out of global base rule keeps properties it forgot.** `src/App.css:178` `input, button` border-radius/border/box-shadow; `background: none; border: none` keeps the shadow. **OPEN, 37 instances.** Fix: scope base rule or shared `.btn-bare`.
  ```
  python3 - <<'PY'
  import re,glob
  for f in sorted(glob.glob('src/**/*.css',recursive=True)):
      t=open(f).read()
      for m in re.finditer(r'([^{}]+)\{([^{}]*)\}',t):
          sel,body=m.group(1).strip(),m.group(2)
          if any(p in sel for p in (':hover',':focus',':active',':disabled','@')): continue
          if re.search(r'\bbackground(-color)?\s*:\s*(none|transparent)',body) and re.search(r'\bborder\s*:\s*none',body) and 'box-shadow' not in body:
              print(f"{f}:{t[:m.start()].count(chr(10))+1}  {sel}")
  PY
  ```
- **Overlay sized to its container breaks when the container's shape varies.** Buffering-sweep `::after` `inset: 0` correct on thin progress track, shapeless glow over tall waveform bars. Fix: animate bars directly, drop overlay box.
  ```
  grep -rn -B6 "inset: 0" src --include='*.css' | grep -E "::(after|before)|--waveform|height:"
  ```
- **TS geometry constant restating CSS value drifts silently.** Measure from DOM. Sum literal (`168 + 14`) = tell of hand-copied box model.
- **Layout constant applied by hand is invisible to library computing offsets.** `AlbumGrid` added `PADDING` itself, `scrollToIndex` parked rows under top edge. Fix: pass `paddingStart`/`paddingEnd`, one writer.
  ```
  grep -rn "virtualRow\.start\|virtualItem\.start\|getTotalSize()" src --include='*.tsx' | grep -v '\.test\.' | grep "[+-]"
  ```
