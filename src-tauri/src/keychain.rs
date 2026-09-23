use keyring::Entry;

// Marks the two variants meaning "the OS secret store itself is unreachable" so the TS side can
// retry them. Canon can autostart before gnome-keyring/kwallet is up, or while the collection is
// still locked, and that failure clears on its own within seconds - unlike NoEntry/BadEncoding,
// which are per-entry and stay broken until the user re-enters the password. The prefix is
// stripped before display (see `useServerWithCredential`), so it never reaches the user.
pub const SECRET_STORE_UNAVAILABLE: &str = "secret-store-unavailable: ";

// keyring's Display already includes the platform error detail; this only adds
// actionable guidance for the two variants that mean "the OS secret store itself
// is unreachable" (as opposed to NoEntry/BadEncoding/etc., which are per-entry).
// Surfaced verbatim in the UI (see App.tsx credError banner), so it's worth being
// specific here rather than showing a bare platform error code to the user.
pub(crate) fn friendly_keyring_error(e: keyring::Error) -> String {
    match e {
        keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_) => format!(
            "{SECRET_STORE_UNAVAILABLE}{e}. On Linux, make sure a Secret Service provider (e.g. \
             gnome-keyring or KWallet) is running; on macOS/Windows, check that Keychain Access / \
             Credential Manager isn't locked or blocked by a permission prompt."
        ),
        other => other.to_string(),
    }
}

// Deleting a secret that is already gone is the outcome the caller wanted. `ServerTab`
// removes the keychain entry before the `servers` row so a secret can never outlive its
// row, and it aborts the whole removal if that fails - so surfacing NoEntry as an error
// made a server whose entry had been lost (keyring reset, rolled-back insert, a profile
// copied between machines) impossible to remove for good.
pub(crate) fn ignore_missing_entry(result: Result<(), keyring::Error>) -> Result<(), String> {
    match result {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(friendly_keyring_error(e)),
    }
}

#[tauri::command]
pub fn set_credential(service: &str, account: &str, secret: &str) -> Result<(), String> {
    Entry::new(service, account)
        .map_err(friendly_keyring_error)?
        .set_password(secret)
        .map_err(friendly_keyring_error)
}

#[tauri::command]
pub fn get_credential(service: &str, account: &str) -> Result<String, String> {
    Entry::new(service, account)
        .map_err(friendly_keyring_error)?
        .get_password()
        .map_err(friendly_keyring_error)
}

#[tauri::command]
pub fn delete_credential(service: &str, account: &str) -> Result<(), String> {
    let entry = Entry::new(service, account).map_err(friendly_keyring_error)?;
    ignore_missing_entry(entry.delete_credential())
}

#[cfg(test)]
mod tests {
    use super::{friendly_keyring_error, ignore_missing_entry, SECRET_STORE_UNAVAILABLE};

    const GUIDANCE: &str = "Secret Service provider";

    #[test]
    fn platform_failure_gains_secret_service_guidance_on_top_of_the_platform_detail() {
        let msg = friendly_keyring_error(keyring::Error::PlatformFailure(Box::from(
            "dbus connection refused",
        )));
        assert!(msg.contains(GUIDANCE), "expected guidance, got: {msg}");
        assert!(
            msg.contains("dbus connection refused"),
            "platform detail must be preserved: {msg}"
        );
    }

    #[test]
    fn no_storage_access_gains_secret_service_guidance() {
        let msg = friendly_keyring_error(keyring::Error::NoStorageAccess(Box::from(
            "keyring is locked",
        )));
        assert!(msg.contains(GUIDANCE), "expected guidance, got: {msg}");
        assert!(
            msg.contains("keyring is locked"),
            "detail must be preserved: {msg}"
        );
    }

    // The prefix is the whole reason a keyring that is not up yet can be retried instead of
    // stranding the session, so it is pinned by name rather than only through the classifier.
    #[test]
    fn an_unreachable_secret_store_is_marked_retriable() {
        for e in [
            keyring::Error::PlatformFailure(Box::from("dbus connection refused")),
            keyring::Error::NoStorageAccess(Box::from("keyring is locked")),
        ] {
            let msg = friendly_keyring_error(e);
            assert!(
                msg.starts_with(SECRET_STORE_UNAVAILABLE),
                "expected the retriable marker, got: {msg}"
            );
        }
    }

    #[test]
    fn a_per_entry_failure_is_not_marked_retriable() {
        for e in [
            keyring::Error::NoEntry,
            keyring::Error::BadEncoding(vec![0xff, 0xfe]),
        ] {
            let msg = friendly_keyring_error(e);
            assert!(
                !msg.starts_with(SECRET_STORE_UNAVAILABLE),
                "a per-entry failure must not be retried: {msg}"
            );
        }
    }

    #[test]
    fn no_entry_is_reported_verbatim_without_guidance() {
        let msg = friendly_keyring_error(keyring::Error::NoEntry);
        assert_eq!(msg, keyring::Error::NoEntry.to_string());
        assert!(!msg.contains(GUIDANCE));
    }

    // ── ignore_missing_entry ──────────────────────────────────────────────────

    #[test]
    fn treats_a_missing_entry_as_a_successful_delete() {
        assert_eq!(ignore_missing_entry(Err(keyring::Error::NoEntry)), Ok(()));
    }

    #[test]
    fn passes_a_real_delete_failure_through() {
        let err = ignore_missing_entry(Err(keyring::Error::NoStorageAccess(Box::from(
            "keyring is locked",
        ))));
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("keyring is locked"));
    }

    #[test]
    fn leaves_a_successful_delete_alone() {
        assert_eq!(ignore_missing_entry(Ok(())), Ok(()));
    }

    #[test]
    fn bad_encoding_is_reported_verbatim_without_guidance() {
        let msg = friendly_keyring_error(keyring::Error::BadEncoding(vec![0xff, 0xfe]));
        assert_eq!(
            msg,
            keyring::Error::BadEncoding(vec![0xff, 0xfe]).to_string()
        );
        assert!(!msg.contains(GUIDANCE));
    }

    #[test]
    fn too_long_is_reported_verbatim_without_guidance() {
        let msg = friendly_keyring_error(keyring::Error::TooLong("password".into(), 512));
        assert_eq!(
            msg,
            keyring::Error::TooLong("password".into(), 512).to_string()
        );
        assert!(!msg.contains(GUIDANCE));
    }

    #[test]
    fn invalid_is_reported_verbatim_without_guidance() {
        let msg = friendly_keyring_error(keyring::Error::Invalid(
            "service".into(),
            "cannot be empty".into(),
        ));
        assert_eq!(
            msg,
            keyring::Error::Invalid("service".into(), "cannot be empty".into()).to_string()
        );
        assert!(!msg.contains(GUIDANCE));
    }

    #[test]
    fn ambiguous_is_reported_verbatim_without_guidance() {
        let msg = friendly_keyring_error(keyring::Error::Ambiguous(Vec::new()));
        assert_eq!(msg, keyring::Error::Ambiguous(Vec::new()).to_string());
        assert!(!msg.contains(GUIDANCE));
    }
}
