use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) struct TrayState {
    pub(crate) close_to_tray: AtomicBool,
}

pub(crate) fn build_tray_menu<R: tauri::Runtime>(
    app: &impl tauri::Manager<R>,
    track_label: &str,
    is_playing: bool,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
    let label = if track_label.is_empty() {
        "Canon"
    } else {
        track_label
    };
    let display = if label.chars().count() > 45 {
        format!("{}…", label.chars().take(45).collect::<String>())
    } else {
        label.to_string()
    };
    let track_item = MenuItemBuilder::new(&display).enabled(false).build(app)?;
    let play_pause = MenuItemBuilder::new(if is_playing {
        "⏸  Pause"
    } else {
        "▶  Play"
    })
    .id("play_pause")
    .build(app)?;
    let next_item = MenuItemBuilder::new("⏭  Next track")
        .id("next")
        .build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let show_item = MenuItemBuilder::new("Show Canon").id("show").build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItemBuilder::new("Quit Canon").id("quit").build(app)?;
    MenuBuilder::new(app)
        .items(&[
            &track_item,
            &play_pause,
            &next_item,
            &sep1,
            &show_item,
            &sep2,
            &quit_item,
        ])
        .build()
}

#[tauri::command]
pub fn tray_update(app: tauri::AppHandle, title: String, is_playing: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        let menu = build_tray_menu(&app, &title, is_playing).map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        let tooltip = if title.is_empty() {
            "Canon".to_string()
        } else {
            format!("Canon - {title}")
        };
        let _ = tray.set_tooltip(Some(&tooltip));
    }
    Ok(())
}

#[tauri::command]
pub fn tray_set_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn tray_set_close_to_tray(state: tauri::State<'_, TrayState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}
