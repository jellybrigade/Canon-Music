use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{Emitter, Manager};

/// Longer than the frontend's own flush deadline, so a healthy frontend always answers first.
const QUIT_WATCHDOG: Duration = Duration::from_secs(5);

#[derive(Default)]
pub(crate) struct QuitState {
    is_frontend_listening: AtomicBool,
    is_quit_pending: AtomicBool,
}

impl QuitState {
    /// A reloading page loses its listener until the new one reports in.
    pub(crate) fn forget_listener(&self) {
        self.is_frontend_listening.store(false, Ordering::Relaxed);
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
    match quit_action(
        state.is_frontend_listening.load(Ordering::Relaxed),
        was_quit_pending,
    ) {
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
    state.is_frontend_listening.store(true, Ordering::Relaxed);
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
        state.is_frontend_listening.store(true, Ordering::Relaxed);
        state.forget_listener();
        assert!(!state.is_frontend_listening.load(Ordering::Relaxed));
    }
}
