use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Asks where to save the backup and writes it there. `Ok(None)` means the user cancelled.
/// The dialog lives here so the webview can only write a file the user just picked.
#[tauri::command]
pub async fn save_settings_backup(
    app: AppHandle,
    contents: String,
    file_name: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app
            .dialog()
            .file()
            .set_file_name(file_name)
            .add_filter("Canon settings backup", &["json"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = with_json_extension(picked.into_path().map_err(|e| e.to_string())?);
        write_backup(&path, &contents)?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// GTK's save dialog keeps the name as typed, so "backup" would save without an extension
// and the import picker, filtered to JSON, would not offer it.
fn with_json_extension(path: PathBuf) -> PathBuf {
    let is_json = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"));
    if is_json {
        path
    } else {
        let mut name = path.into_os_string();
        name.push(".json");
        PathBuf::from(name)
    }
}

fn write_backup(path: &Path, contents: &str) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_json_extension_only_when_missing() {
        assert_eq!(
            with_json_extension(PathBuf::from("/tmp/backup")),
            PathBuf::from("/tmp/backup.json")
        );
        assert_eq!(
            with_json_extension(PathBuf::from("/tmp/backup.v2")),
            PathBuf::from("/tmp/backup.v2.json")
        );
        assert_eq!(
            with_json_extension(PathBuf::from("/tmp/backup.JSON")),
            PathBuf::from("/tmp/backup.JSON")
        );
    }

    #[test]
    fn write_failure_names_the_path() {
        let missing = std::env::temp_dir().join("canon-no-such-dir/backup.json");
        let error = write_backup(&missing, "{}").unwrap_err();
        assert!(error.contains("canon-no-such-dir"), "{error}");
    }

    #[test]
    fn writes_contents() {
        let path = std::env::temp_dir().join(format!("canon-backup-{}.json", std::process::id()));
        write_backup(&path, "{\"a\":\"1\"}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":\"1\"}");
        std::fs::remove_file(&path).unwrap();
    }
}
