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
        let picked = picked.into_path().map_err(|e| e.to_string())?;
        let path = with_json_extension(picked.clone());
        // The dialog only confirmed replacing the name it was given, not the one with ".json" added.
        let may_replace = path == picked;
        write_backup(&path, &contents, may_replace)?;
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

fn write_backup(path: &Path, contents: &str, may_replace: bool) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true);
    if may_replace {
        options.create(true).truncate(true);
    } else {
        options.create_new(true);
    }
    let mut file = options.open(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            format!(
                "{} already exists. Pick it by its full name to replace it.",
                path.display()
            )
        } else {
            format!("Could not write {}: {e}", path.display())
        }
    })?;
    std::io::Write::write_all(&mut file, contents.as_bytes())
        .map_err(|e| format!("Could not write {}: {e}", path.display()))
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
        let error = write_backup(&missing, "{}", true).unwrap_err();
        assert!(error.contains("canon-no-such-dir"), "{error}");
    }

    #[test]
    fn writes_contents() {
        let path = std::env::temp_dir().join(format!("canon-backup-{}.json", std::process::id()));
        write_backup(&path, "{\"a\":\"1\"}", true).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":\"1\"}");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn replaces_an_existing_file_only_when_the_dialog_confirmed_it() {
        let path =
            std::env::temp_dir().join(format!("canon-backup-existing-{}.json", std::process::id()));
        std::fs::write(&path, "old contents").unwrap();

        let error = write_backup(&path, "{}", false).unwrap_err();
        assert!(error.contains("already exists"), "{error}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old contents");

        write_backup(&path, "{}", true).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
        std::fs::remove_file(&path).unwrap();
    }
}
