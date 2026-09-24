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
  grep -rln "createPortal" src/components src/pages src/ui src/features --include='*.tsx' | grep -v '\.test\.' | xargs grep -Ln "useModalChrome"
  grep -rn "backdrop\|overlay" src/components src/pages src/ui src/features --include='*.tsx' | grep -v '\.test\.' | grep "onClick={(e)\|onMouseDown={(e)"
  ```
  ```
  grep -rln "createPortal" src/components src/pages src/ui src/features --include='*.tsx' | xargs grep -Ln "useModalChrome"
  ```
- **Backdrop `click` dismiss fires on a gesture that only ended there.** Fix: `useOverlayDismiss` arms `mousedown` at backdrop, closes only if release matches. Target identity, never `stopPropagation`.
  ```
  grep -rn "onClick={(e) => e.stopPropagation()}" src --include='*.tsx' | grep -v '\.test\.'
  ```
- **`Number(x) || fallback` deletes a legal zero.** Kills any `Math.max` floor beside it. Branch on `""` explicitly, then clamp.
  ```
  grep -rn "Number(.*)\s*||\|parseInt(.*)\s*||\|parseFloat(.*)\s*||" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Non-URL render state must be dismissed by navigation intent, not pathname change.** Overlays-as-state stayed painted when the target route equalled the current pathname. Fix: `useAppNavigation` runs `dismissOverlays` at the top of every nav call via ref. Only the command palette is left: search became the `/search` route (2026-09-09), and leaving the class beats a third dismissal mechanism. Exemption: `SearchView`'s `?q` `replace` never changes the pathname; it takes `leaveSearch` from props.
  ```
  grep -rn "useNavigate()\|useSearchParams()" src --include='*.ts*' | grep -v '\.test\.' | grep -v useAppNavigation
  ```
- **Dismissal at same priority as its navigation can't land first.** `dismissOverlays` in `startTransition` shared Suspense boundary with route's lazy import - overlay stayed painted during chunk download. Fix: keep dismissal urgent.
  ```
  grep -rn "startTransition" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Navigating to the page already showing pushes a duplicate history entry.** Sidebar item, album/artist/playlist already open: Back then landed on the same page. On `/search` it was worse - `leaveSearch` is `navigate(-1)`, so Escape and the header Back button returned into search. Fix: one private `goTo(path)` in `useAppNavigation` skips `navigate` when the target equals `pathname`, dismisses either way. Compared on pathname alone, so the query in the box survives.
  ```
  grep -rn "navigate(" src --include='*.ts*' | grep -v '\.test\.' | grep -vE "navigate\((-?1|\+1)\)"
  ```
- **`location.key === "default"` stops marking the first history entry once that entry is replaced.** `SearchView` writes `?q` with `replace`, minting a fresh key, so one keystroke on a cold-mounted `/search` (the `web-process-terminated -> reload()` recovery) left `leaveSearch` running `navigate(-1)` with nothing behind it: Escape and Back both did nothing. Fix: track it off `useNavigationType()` - push leaves the entry, replace stays on it and carries the key over, pop is back on it when the key matches.
  ```
  grep -rn "location\.key\|useNavigationType" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Router value copied into `useState` never resyncs while the route stays mounted.** `SearchView`'s box kept the old term, clear button and all, when a navigation aimed at `/search` with a different `?q` or none. Fix: resync during render against what this view itself last wrote (`lastWrittenRef`), never against the param, or in-flight keystrokes get clobbered.
  ```
  grep -rnE "useState\((searchParams|params|query|pathname)" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **`null` for "don't know yet" and "isn't there" paints the same blank page.** `data ?? null` collapses `useQuery`'s pending distinction. Name the pending state. **Found again:** the progress bar read `waveformPeaks: null` (cleared on every track change) as "no waveform" and dropped to the 3px bar until peaks loaded, jumping the layout per track. Fix: `displayedWaveformPeaks` draws a flat placeholder; only the setting decides the variant.
  ```
  grep -rn "data:.*\} = useQuery" src/app --include='*.tsx' | grep -v '\.test\.'
  ```
- **Prerequisite gate is a state machine too; confident-wrong beats blank-wrong, but both are wrong.** 8 browse routes drifted into 3 wrong messages (told user to add a server they already have, stuck "Loading...", blank `<main>`). Fix: shared `CredentialNotice`/`CredentialGate`, pending vs failed vs absent.
  ```
  grep -rn "if (!serverWithCred\|if (!credential\|if (!server)\|if (!session" src --include='*.tsx' | grep -v '\.test\.'
  grep -rn "serverWithCred ?" src --include='*.tsx' | grep -v '\.test\.'
  ```
- **An error path that builds its own value can fail before delivering the message.** Both `authenticate` paths reported `new URL(baseUrl).origin`, which drops a subpath install's path (the user was told to check an address nothing contacted) and throws `TypeError: Invalid URL` on a typo'd host - inside the branch written for exactly that user. Fix: one `pingFailureMessage` helper reporting the URL `apiPost` actually used. An error path owes the same "cannot itself fail" scrutiny as a cleanup path.
  ```
  grep -rn "new URL(" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Decoding an already-decoded value = no-op or crash.** react-router decodes params once; second decode threw `URIError` or silently mangled `%20`. Test via real router (`src/lib/routes.router.test.tsx`). Known limit: literal `%2F` in name can't round-trip.
  ```
  grep -rn "decodeURIComponent\|unescape(" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Partial opt-out of global base rule keeps properties it forgot.** `src/styles/base.css:232` `input, button` border-radius/border/box-shadow; `background: none; border: none` keeps the shadow. **OPEN, 37 instances.** Fix: scope base rule or shared `.btn-bare`.
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
- **Hit-area halo grown toward a neighbour steals its clicks.** Search clear button `inset: -10px` reached across the bar's 4px gap into the input, so clicking the tail of the query to place a caret wiped it. **Found 3x:** alias remove crossed into the next chip (removed the wrong alias), and two `artist-icon-btn` halos both claimed the middle of their 8px gap, where the later sibling won. Rule: grow away from a neighbour outright, else no further than half the gap. Every hit below owes that arithmetic against its container's `gap` and `padding`.
  ```
  grep -rn "inset: -" src --include='*.css'
  ```
- **Overlay sized to its container breaks when the container's shape varies.** Buffering-sweep `::after` `inset: 0` correct on thin progress track, shapeless glow over tall waveform bars. Fix: animate bars directly, drop overlay box.
  ```
  grep -rn -B6 "inset: 0" src --include='*.css' | grep -E "::(after|before)|--waveform|height:"
  ```
- **A grid cell that can render `null` hands its column to the next sibling.** The tag review row put its cells straight into a subgrid via `display: contents`, so `AlbumArtStrip` or `TagSourceDots` returning `null` shifted every later cell one column left and hid "Map to genre". Fix: the row owns one wrapper per column. Pinned by `TagReviewTab.test.tsx`. Ask of any fixed-column grid row: which direct children can render nothing?
  ```
  grep -rn "display: contents\|subgrid" src --include='*.css'
  ```
- **An option's "selected" test must compare to that option, not ask whether any option is set.** The sleep timer menu marked each minute preset active on `sleepTimerEndsAt` being non-null, so arming 30 min lit up 15, 30, 45 and 60 alike. The store held only the end time, so nothing could say which preset armed it. Fix: `sleepTimerMinutes` beside `sleepTimerEndsAt`, row active on `sleepTimerMinutes === min`. Ask of any mapped list's active class: does the condition mention the item?
  ```
  grep -rn -A4 "\.map((" src --include='*.tsx' | grep -v '\.test\.' | grep -E "(--active|--selected)\" : \"\"" | grep -v "===\|!==\|\.has(\|\.includes("
  ```
- **A menu's sub-mode held by its parent outlives the menu.** The album page kept the track context menu's `"main" | "playlist"` mode in page state and reset it only on dismiss, so picking a playlist closed the menu with the mode still `"playlist"` and the next right-click on any track opened straight onto the playlist list. Fix: `TrackContextMenu` owns its mode, so every close unmounts it. Pinned by `TrackContextMenu.test.tsx`. Ask of any state describing an open popup: does it die with the popup?
  ```
  grep -rnE "useState<\"main\"|[mM]enuMode" src --include='*.tsx' | grep -v '\.test\.'
  ```
- **A `var()` naming a token nobody defines computes to the property's initial value.** `RadioStartDialog` read `var(--bg-surface)`, never defined, so its `background` was transparent from day one; siblings hid the same ghost behind `#1e1e1e` fallbacks. 8 ghost tokens, 14 reads. Fix: real tokens, `src/lib/cssTokenGuard.test.ts` fails on any read without a definition. A fallback on a design token is a tell, not proof: most here name real tokens.
  ```
  pnpm vitest run src/lib/cssTokenGuard.test.ts
  ```
- **Flex item with a fixed basis narrower than its content overflows onto its neighbours.** Player bar right side was `flex: 0 0 310px` holding ~435px of buttons, and the narrow layout started at 640px, far below the ~900px the full row needs, so volume clipped and buttons overlaid the waveform. Transport controls centred on the bar, waveform on its column, so the two sat off each other. Fix: equal-grow sides, controls positioned in the center column, stars drop at 1100px, narrow layout at 900px. Not reproducible in jsdom (no layout).
  ```
  grep -rnE "flex: 0 0 [0-9]+px" src --include='*.css'
  ```
- **TS geometry constant restating CSS value drifts silently.** Measure from DOM. Sum literal (`168 + 14`) = tell of hand-copied box model.
- **Layout constant applied by hand is invisible to library computing offsets.** `AlbumGrid` added `PADDING` itself, `scrollToIndex` parked rows under top edge. Fix: pass `paddingStart`/`paddingEnd`, one writer.
  ```
  grep -rn "virtualRow\.start\|virtualItem\.start\|getTotalSize()" src --include='*.tsx' | grep -v '\.test\.' | grep "[+-]"
  ```
