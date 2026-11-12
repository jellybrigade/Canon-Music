use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use tauri::{Emitter, Manager};

/// Longer than the frontend's own flush deadline, so a healthy frontend always answers first.
const QUIT_WATCHDOG: Duration = Duration::from_secs(5);

#[derive(Default)]
pub(crate) struct QuitState {
    /// A count, not a flag: a remount's "ready" can arrive before the old listener's "gone".
    listener_count: AtomicUsize,
    is_quit_pending: AtomicBool,
}

impl QuitState {
    /// A reloading page loses its listener until the new one reports in.
    pub(crate) fn forget_listener(&self) {
        self.listener_count.store(0, Ordering::Relaxed);
    }

    fn add_listener(&self) {
        self.listener_count.fetch_add(1, Ordering::Relaxed);
    }

    fn remove_listener(&self) {
        let _ = self
            .listener_count
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |count| {
                Some(count.saturating_sub(1))
            });
    }

    fn is_frontend_listening(&self) -> bool {
        self.listener_count.load(Ordering::Relaxed) > 0
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum QuitAction {
    AskFrontend,
    ExitNow,
    AlreadyQuitting,
}

pub(crate) fn quit_action(is_frontend_listening: bool, was_quit_pending: bool) -> QuitAction {
    if was_quit_pending {
        QuitAction::AlreadyQuitting
    } else if is_frontend_listening {
        QuitAction::AskFrontend
    } else {
        QuitAction::ExitNow
    }
}

/// Lets the frontend write its debounced queue, volume and server queue save before the
/// process ends; `app.exit` alone never gives the webview a chance to run them.
pub(crate) fn request_quit(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<QuitState>() else {
        app.exit(0);
        return;
    };
    let was_quit_pending = state.is_quit_pending.swap(true, Ordering::Relaxed);
    match quit_action(state.is_frontend_listening(), was_quit_pending) {
        QuitAction::AlreadyQuitting => {}
        QuitAction::ExitNow => app.exit(0),
        QuitAction::AskFrontend => {
            if app.emit("quit-requested", ()).is_err() {
                app.exit(0);
                return;
            }
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(QUIT_WATCHDOG);
                eprintln!("[quit] frontend never confirmed its flush - exiting anyway");
                app.exit(0);
            });
        }
    }
}

#[tauri::command]
pub fn quit_listener_ready(state: tauri::State<'_, QuitState>) {
    state.add_listener();
}

/// An unmount without a page load (the error boundary's recovery) stops the listener too.
#[tauri::command]
pub fn quit_listener_gone(state: tauri::State<'_, QuitState>) {
    state.remove_listener();
}

#[tauri::command]
pub fn quit_ready(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_a_listening_frontend_to_flush_first() {
        assert_eq!(quit_action(true, false), QuitAction::AskFrontend);
    }

    #[test]
    fn exits_at_once_when_no_frontend_is_listening() {
        assert_eq!(quit_action(false, false), QuitAction::ExitNow);
    }

    #[test]
    fn a_second_request_during_the_flush_does_not_restart_it() {
        assert_eq!(quit_action(true, true), QuitAction::AlreadyQuitting);
        assert_eq!(quit_action(false, true), QuitAction::AlreadyQuitting);
    }

    #[test]
    fn a_reload_forgets_the_listener() {
        let state = QuitState::default();
        state.add_listener();
        state.forget_listener();
        assert!(!state.is_frontend_listening());
    }

    #[test]
    fn a_listener_gone_without_a_reload_is_forgotten() {
        let state = QuitState::default();
        state.add_listener();
        state.remove_listener();
        assert!(!state.is_frontend_listening());
    }

    #[test]
    fn a_remount_reporting_in_before_the_old_listener_leaves_still_counts() {
        let state = QuitState::default();
        state.add_listener();
        state.add_listener();
        state.remove_listener();
        assert!(state.is_frontend_listening());
        state.remove_listener();
        state.remove_listener();
        assert!(!state.is_frontend_listening());
    }
}
