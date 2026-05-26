---
description: Server authentication — per-server auth flows, keychain storage, credential format
paths:
  - "src/keychain.ts"
  - "src/hooks/useServer.ts"
  - "src/lib/navidrome.ts"
  - "src/components/AddServerModal.tsx"
---

# Server Authentication

## Auth Flows by Server Type

| Server | Flow |
|---|---|
| Navidrome | OpenSubsonic `ping.view` with MD5 token + salt |
| Jellyfin | username/password → API key (not implemented yet) |
| Plex | OAuth2 flow via plex.tv → token (not implemented yet) |

## Keychain Storage

All tokens stored in OS keychain via `tauri-plugin-keychain` (Rust) + `src/keychain.ts` (TS wrapper).

Key format:
- `service = "canon.server.{server.id}"`
- `account = "credential"`
- `value = JSON.stringify({ token, salt })`

Credentials are **never** written to SQLite, localStorage, Zustand, or environment variables.

## `keychain.ts`

Thin wrapper over Tauri commands:
```ts
keychain.set(service, account, secret)   // invoke("set_credential", ...)
keychain.get(service, account)           // invoke("get_credential", ...)
keychain.delete(service, account)        // invoke("delete_credential", ...)
```

## `useServer.ts`

- `useServers()` — all server rows from SQLite
- `useServerWithCredential()` — joins server row with keychain lookup; returns `ServerWithCredential`
- Components always use `ServerWithCredential` — never access keychain directly

## Linux Note

Keyring requires `linux-native-sync-persistent` + `crypto-rust` features in `Cargo.toml`. Without them it silently falls back to in-memory mock (credentials lost on restart).
