use serde::Serialize;
use std::time::{Duration, Instant};

/// Short on purpose: this runs only after the webview has already spent its own ladder,
/// and it exists to answer one question fast, not to fetch anything useful.
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerProbe {
    pub reachable: bool,
    pub status: Option<u16>,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

/// Unauthenticated ping: an auth-error envelope still arrives over HTTP 200, which is all
/// the probe asks about, and it keeps credentials out of a message written to be shown.
pub fn probe_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    let trimmed = trimmed.strip_suffix("/rest").unwrap_or(trimmed);
    format!("{trimmed}/rest/ping.view?v=1.16.1&c=canon&f=json")
}

/// reqwest's own Display includes the full URL and the whole source chain, which reads as
/// noise in a one-line notice the user sees.
pub fn describe_failure(is_timeout: bool, is_connect: bool, raw: &str) -> String {
    if is_timeout {
        return format!("no answer in {}s", PROBE_TIMEOUT.as_secs());
    }
    if is_connect {
        return "connection refused or host unreachable".to_string();
    }
    let first_line = raw.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        "request failed".to_string()
    } else {
        first_line.to_string()
    }
}

fn run_probe(base_url: &str) -> ServerProbe {
    let started = Instant::now();
    let client = match reqwest::blocking::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            return ServerProbe {
                reachable: false,
                status: None,
                elapsed_ms: 0,
                error: Some(describe_failure(false, false, &err.to_string())),
            }
        }
    };
    match client.get(probe_url(base_url)).send() {
        Ok(res) => ServerProbe {
            reachable: true,
            status: Some(res.status().as_u16()),
            elapsed_ms: started.elapsed().as_millis() as u64,
            error: None,
        },
        Err(err) => ServerProbe {
            reachable: false,
            status: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
            error: Some(describe_failure(
                err.is_timeout(),
                err.is_connect(),
                &err.to_string(),
            )),
        },
    }
}

/// Reaches the server over Rust's HTTP client, which shares the machine's network but not
/// the webview's proxy resolver. "Rust got through, the webview did not" is what localises
/// a stall to this desktop's HTTP configuration instead of to the server.
#[tauri::command]
pub async fn probe_server(url: String) -> Result<ServerProbe, String> {
    tauri::async_runtime::spawn_blocking(move || run_probe(&url))
        .await
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_ping_url_from_a_bare_base() {
        assert_eq!(
            probe_url("https://navi.example"),
            "https://navi.example/rest/ping.view?v=1.16.1&c=canon&f=json"
        );
    }

    #[test]
    fn strips_trailing_slashes() {
        assert_eq!(
            probe_url("https://navi.example///"),
            "https://navi.example/rest/ping.view?v=1.16.1&c=canon&f=json"
        );
    }

    #[test]
    fn strips_an_accidental_rest_suffix() {
        assert_eq!(
            probe_url("https://navi.example/rest"),
            "https://navi.example/rest/ping.view?v=1.16.1&c=canon&f=json"
        );
    }

    #[test]
    fn keeps_a_subpath_install() {
        assert_eq!(
            probe_url("https://host.example/music/"),
            "https://host.example/music/rest/ping.view?v=1.16.1&c=canon&f=json"
        );
    }

    #[test]
    fn names_a_timeout_by_its_budget() {
        assert_eq!(describe_failure(true, false, "whatever"), "no answer in 8s");
    }

    #[test]
    fn names_a_refused_connection() {
        assert!(describe_failure(false, true, "x").contains("unreachable"));
    }

    #[test]
    fn keeps_only_the_first_line_of_an_unclassified_error() {
        assert_eq!(
            describe_failure(false, false, "bad certificate\n  caused by: expired"),
            "bad certificate"
        );
    }

    #[test]
    fn falls_back_when_the_error_has_no_text() {
        assert_eq!(describe_failure(false, false, "   "), "request failed");
    }
}
