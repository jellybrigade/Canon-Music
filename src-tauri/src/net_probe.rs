use serde::Serialize;
use std::error::Error;
use std::io::ErrorKind;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureCause {
    UntrustedCertificate,
    HostNotFound,
    Refused,
}

impl FailureCause {
    fn describe(self) -> &'static str {
        match self {
            Self::UntrustedCertificate => "something on your network is blocking it",
            Self::HostNotFound => "the address couldn't be found (check your internet connection)",
            Self::Refused => "the site refused the connection",
        }
    }
}

/// reqwest's Display names only its outermost layer ("error sending request"), and
/// `is_connect` is true for a TLS failure too, so the cause is read from the chain below.
pub fn failure_cause(err: &(dyn Error + 'static)) -> Option<FailureCause> {
    let mut layer = Some(err);
    while let Some(current) = layer {
        if current
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io| io.kind() == ErrorKind::ConnectionRefused)
        {
            return Some(FailureCause::Refused);
        }
        let text = current.to_string();
        if text.starts_with("invalid peer certificate") {
            return Some(FailureCause::UntrustedCertificate);
        }
        if text == "dns error" {
            return Some(FailureCause::HostNotFound);
        }
        layer = current.source();
    }
    None
}

/// reqwest's own Display includes the full URL and the whole source chain, which reads as
/// noise in a one-line notice the user sees.
pub fn describe_failure(
    is_timeout: bool,
    cause: Option<FailureCause>,
    is_connect: bool,
    raw: &str,
) -> String {
    if is_timeout {
        return "no answer".to_string();
    }
    if let Some(cause) = cause {
        return cause.describe().to_string();
    }
    if is_connect {
        return "couldn't connect".to_string();
    }
    let first_line = raw.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        "request failed".to_string()
    } else {
        first_line.to_string()
    }
}

fn describe_request_error(err: &reqwest::Error) -> String {
    describe_failure(
        err.is_timeout(),
        failure_cause(err),
        err.is_connect(),
        &err.to_string(),
    )
}

fn probe_client() -> reqwest::Result<reqwest::blocking::Client> {
    // Built on `rustls-tls-native-roots`, not bundled webpki roots, so this client trusts what
    // WebKitGTK trusts; otherwise a private-CA Navidrome would be reported down.
    reqwest::blocking::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .build()
}

fn run_probe(base_url: &str) -> ServerProbe {
    let started = Instant::now();
    let client = match probe_client() {
        Ok(client) => client,
        Err(err) => {
            return ServerProbe {
                reachable: false,
                status: None,
                elapsed_ms: 0,
                error: Some(describe_request_error(&err)),
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
            error: Some(describe_request_error(&err)),
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

/// What the native fetch can't say: it passes on only reqwest's outermost layer. `None` when
/// the repeat gets through or its failure has no plainer name, so the caller keeps its own.
fn diagnose(url: &str) -> Option<String> {
    let url = reqwest::Url::parse(url).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let err = probe_client().ok()?.head(url).send().err()?;
    if err.is_timeout() {
        return Some(describe_request_error(&err));
    }
    failure_cause(&err)
        .map(FailureCause::describe)
        .map(str::to_string)
}

#[tauri::command]
pub async fn diagnose_request(url: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || diagnose(&url))
        .await
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt;

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
    fn names_a_timeout() {
        assert_eq!(describe_failure(true, None, false, "whatever"), "no answer");
    }

    #[test]
    fn a_connect_failure_with_a_known_cause_says_the_cause() {
        assert_eq!(
            describe_failure(false, Some(FailureCause::UntrustedCertificate), true, "x"),
            FailureCause::UntrustedCertificate.describe()
        );
    }

    #[test]
    fn a_connect_failure_without_a_cause_claims_nothing_more() {
        assert_eq!(describe_failure(false, None, true, "x"), "couldn't connect");
    }

    /// One layer of reqwest's chain: its text, and the layer beneath it.
    #[derive(Debug)]
    struct Layer {
        text: &'static str,
        source: Option<Box<dyn Error + 'static>>,
    }

    impl fmt::Display for Layer {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(self.text)
        }
    }

    impl Error for Layer {
        fn source(&self) -> Option<&(dyn Error + 'static)> {
            self.source.as_deref()
        }
    }

    /// The layers reqwest 0.12 reports, outermost first, ending in `innermost`.
    fn reqwest_chain(middle: &'static str, innermost: Box<dyn Error + 'static>) -> Layer {
        Layer {
            text: "error sending request for url (https://webservice.fanart.tv/)",
            source: Some(Box::new(Layer {
                text: "client error (Connect)",
                source: Some(Box::new(Layer {
                    text: middle,
                    source: Some(innermost),
                })),
            })),
        }
    }

    #[test]
    fn reads_an_untrusted_certificate_from_deep_in_the_chain() {
        let err = Layer {
            text: "error sending request for url (https://webservice.fanart.tv/)",
            source: Some(Box::new(Layer {
                text: "client error (Connect)",
                source: Some(Box::new(std::io::Error::other(
                    "invalid peer certificate: UnknownIssuer",
                ))),
            })),
        };
        assert_eq!(
            failure_cause(&err),
            Some(FailureCause::UntrustedCertificate)
        );
    }

    #[test]
    fn reads_a_failed_lookup_as_host_not_found() {
        let err = reqwest_chain(
            "dns error",
            Box::new(std::io::Error::other(
                "failed to lookup address information: Name or service not known",
            )),
        );
        assert_eq!(failure_cause(&err), Some(FailureCause::HostNotFound));
    }

    #[test]
    fn reads_a_refused_connection() {
        let err = reqwest_chain(
            "tcp connect error",
            Box::new(std::io::Error::from(ErrorKind::ConnectionRefused)),
        );
        assert_eq!(failure_cause(&err), Some(FailureCause::Refused));
    }

    #[test]
    fn names_no_cause_it_cannot_find() {
        let err = reqwest_chain(
            "tcp connect error",
            Box::new(std::io::Error::from(ErrorKind::NetworkUnreachable)),
        );
        assert_eq!(failure_cause(&err), None);
    }

    #[test]
    fn refuses_to_diagnose_anything_but_web_addresses() {
        assert_eq!(diagnose("file:///etc/passwd"), None);
        assert_eq!(diagnose("not a url"), None);
    }

    #[test]
    fn keeps_only_the_first_line_of_an_unclassified_error() {
        assert_eq!(
            describe_failure(false, None, false, "bad certificate\n  caused by: expired"),
            "bad certificate"
        );
    }

    #[test]
    fn falls_back_when_the_error_has_no_text() {
        assert_eq!(
            describe_failure(false, None, false, "   "),
            "request failed"
        );
    }
}
