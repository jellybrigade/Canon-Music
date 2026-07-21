# Setup Wizard

## What it is

The first screen a new user sees: a 4-step guided flow that connects Canon to a Navidrome server, optionally configures Last.fm/Fanart.tv keys and update/tag-refresh preferences, and hands off to the main app. Runs once per install (until a server exists in `servers` table) but is also reachable any time a fresh server connection is needed.

## Entry points

Rendered whenever the app has no configured server (`src/App.tsx` renders `Wizard` in place of the main shell). No settings-page trigger — it's a startup gate, not a dialog the user opens deliberately.

Full-viewport backdrop (`.wizard-backdrop`), centered panel (`.wizard`), fixed width 440px, scrolls internally if content taller than viewport.

## Step by step

1. **Step 1 — Welcome.** Canon wordmark + "Welcome to Canon" heading, two lines explaining what Canon does (tag normalization, never touches files), an alpha-disclaimer notice. Single "Continue" button advances to step 2.
2. **Step 2 — Connect your Navidrome server.** Fields: Server URL, optional Alternate URL, Username, an auth-method tab switch (Password / API Key, underline-tab style), Password or API Key field depending on selection, Display name (auto-filled from the URL's hostname on first entry, editable after). "Test connection" button calls `authenticate`/`authenticateWithApiKey` (`src/lib/navidrome.ts`); result renders inline as a tinted feedback chip — green checkmark chip "Connection successful." on success, red alert-icon chip with the raw error message on failure. Editing any field after a successful test invalidates the test (chip disappears, must re-test) via `handleUrlChange`/`handleCredentialChange`/`handleAuthMethodChange` resetting `testState`. "Continue" is disabled until `step2Complete` (test passed against the exact fields currently in the form, checked via a snapshot comparison, plus a non-empty display name).
3. **Step 3 — Optional setup.** Five stacked sections, each with an uppercase tracked label matching Settings' own section-title style: Last.fm API key, Fanart.tv API key, Auto-refresh metadata on launch (+ staleness-days number input), auto-check for updates (+ interval `<select>`), and an "Import settings" action wrapped in a subtly boxed panel (distinct tinted background/border, since it's a one-off action rather than a persistent toggle) that lets the user restore a previously exported settings backup file. "I'll do it later" and "Continue" both advance to step 4 — nothing here is required.
4. **Step 4 — Done.** "You're all set" confirmation. "Open Canon" button writes the server row (`servers` table) and credential (OS keychain), then calls `onSuccess(server)` to hand off to the main app shell. Any save failure renders inline as the same red feedback chip used in step 2.

Progress indicator across the top: 4 dots joined by connector segments. Current step's dot is enlarged and accent-colored; completed steps' dots/connectors turn `--text-tertiary`; upcoming ones stay `--surface-3`. A small "Step N of 4" label sits directly below it. Each step's content fades/slides in on mount (`wizard-step-in` keyframe, respects the app's global `prefers-reduced-motion` override in `src/App.css`).

## Edge cases / gotchas

- **Test invalidation is snapshot-based, not just "did test pass."** `snapshotMatch` compares the currently-typed URL/username/authMethod/password-or-apiKey against what was tested. Changing the auth method tab, even back to a value it was already tested at, resets `testState` to idle — there's no memoization across auth-method switches.
- Display name auto-fill only fires while the field is empty (`if (!displayName)` in `handleUrlChange`) — once the user types anything into Display name, URL edits stop overwriting it.
- Fanart key is fetched once on mount from keychain (`getFanartApiKey()`); Last.fm key is not pre-loaded (starts blank each run) — asymmetry is existing behavior, not something this redesign changed.
- `altUrl` and empty display name are trimmed and trailing-slash-stripped only at step-4 save time (`handleFinish`), not live.
- The wizard has no back button between steps 2-4 — only forward. Re-testing or re-entering fields is the only correction path within a step.
- Left-click popovers aren't used here, so the WebKitGTK left-click-menu self-close bug (`known-issues.md`) doesn't apply to this component.

## Implementation

- `src/components/setup/Wizard.tsx:40-441` — `Wizard` component, all step state local (`step: 1|2|3|4`, connection fields, step-3 setting fields via `useBoolSetting`/`useSetting`).
- `src/components/setup/Wizard.css` — `.wizard-backdrop`/`.wizard` shell (now with `--surface-1` background, `--border`, `--radius-lg`, `--shadow-2`, replacing the previous borderless/backgroundless panel); `.wizard-step-dot`/`.wizard-step-dot-wrap`/`.wizard-step-track` progress indicator; `.wizard-step-label`; `.wizard-feedback`/`.wizard-feedback--success`/`.wizard-feedback--error` tinted icon chips (`color-mix(in srgb, var(--success-b|danger) 15%, transparent)` backgrounds, mirroring `UpdatePrompt.css`'s `.changelog-badge` tint pattern); `.wizard-import-box` (boxed panel around the Import settings section); `wizard-step-in` keyframe (fade + 4px translateY on mount).
- Feedback icons: `CheckCircle`/`AlertCircle` from `lucide-react`, same icon vocabulary as `IdentifyDialog.tsx`'s status icons.
- Step 3 reuses `src/components/settings/SettingRow.tsx` and `SettingsView.css`'s `.settings-section`/`.settings-section-title`/`.settings-section-desc` classes directly (imported via `import "../SettingsView.css"`), so any Settings-page section styling change also affects this step.
- Auth: `authenticate`/`authenticateWithApiKey` (`src/lib/navidrome.ts`), credential persisted via `keychain.set` (`src/keychain.ts`, OS keychain — see `.claude/rules/server-auth.md`).
- Server row insert: raw `db.execute`/`db.select` against the `servers` table via `getDb()` (`src/db/index.ts`) — this component still uses `tauri-plugin-sql` directly, not the rusqlite read-path pilot (`useAlbums`/`useArtists`/`useTracks`) elsewhere in the app.
- No schema or Tauri-command changes — this pass was CSS/JSX only.

## Open questions

- No back-navigation between steps is a product decision that predates this pass — not verified whether intentional-permanent or a known gap.
