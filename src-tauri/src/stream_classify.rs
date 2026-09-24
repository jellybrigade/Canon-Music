//! Decides whether a stream response is actually audio before it reaches the decoder.
//!
//! Subsonic rides its errors on HTTP 200 with a JSON or XML body, so the status line and
//! the content-type together still cannot tell a track from `{"error":{"code":70}}`. Handed
//! to `Decoder::new` that body surfaces as "this file could not be decoded", blaming the
//! file for a stale id.

/// What the response turned out to be.
#[derive(Debug, PartialEq, Eq)]
pub enum StreamVerdict {
    Audio { codec: String },
    Failure(StreamFailure),
}

/// A response that must not reach the decoder, in the shape the `audio-error` event wants.
#[derive(Debug, PartialEq, Eq)]
pub struct StreamFailure {
    pub message: String,
    pub detail: Option<String>,
    pub retryable: bool,
    /// Subsonic's own error code when the body carried an error envelope. 70 means the id is
    /// gone, which the frontend answers by re-resolving the album rather than by retrying.
    pub subsonic_code: Option<i64>,
}

/// How much of the body the caller must read before classifying. Subsonic error envelopes are
/// a couple of hundred bytes; container magic sits in the first 12.
pub const STREAM_HEAD_BYTES: usize = 8192;

fn codec_from_content_type(content_type: &str) -> Option<&'static str> {
    let ct = content_type.to_lowercase();
    if ct.contains("flac") {
        Some("FLAC")
    } else if ct.contains("mpeg") || ct.contains("mp3") {
        Some("MP3")
    } else if ct.contains("opus") {
        Some("Opus")
    } else if ct.contains("ogg") {
        Some("OGG")
    } else if ct.contains("aac") || ct.contains("mp4") || ct.contains("m4a") {
        Some("AAC")
    } else if ct.contains("wav") {
        Some("WAV")
    } else {
        None
    }
}

fn codec_from_magic(head: &[u8]) -> Option<&'static str> {
    if head.starts_with(b"fLaC") {
        Some("FLAC")
    } else if head.starts_with(b"OggS") {
        Some("OGG")
    } else if head.starts_with(b"ID3") {
        Some("MP3")
    } else if head.starts_with(b"RIFF") {
        Some("WAV")
    } else if head.len() >= 8 && &head[4..8] == b"ftyp" {
        Some("AAC")
    } else if head.len() >= 2 && head[0] == 0xFF && head[1] & 0xE0 == 0xE0 {
        Some("MP3")
    } else {
        None
    }
}

fn first_non_space(head: &[u8]) -> Option<u8> {
    head.iter().copied().find(|b| !b.is_ascii_whitespace())
}

/// Pull `code` and `message` out of a `subsonic-response` envelope, JSON or XML.
///
/// `f=xml` is legal Subsonic and some deployments answer with it regardless of what was
/// asked for, so both spellings have to be understood here.
fn parse_subsonic_error(head: &[u8]) -> Option<(i64, String)> {
    let text = String::from_utf8_lossy(head);
    if !text.contains("subsonic-response") {
        return None;
    }

    if first_non_space(head) == Some(b'{') {
        let parsed: serde_json::Value = serde_json::from_str(text.trim()).ok()?;
        let error = parsed.get("subsonic-response")?.get("error")?;
        let code = error.get("code")?.as_i64()?;
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        return Some((code, message));
    }

    let code = xml_attribute(&text, "code")?.parse::<i64>().ok()?;
    let message = xml_attribute(&text, "message").unwrap_or_default();
    Some((code, message))
}

fn xml_attribute(text: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let start = text.find(&needle)? + needle.len();
    let rest = &text[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn subsonic_failure(code: i64, message: String) -> StreamFailure {
    let described =
        match code {
            70 => "This track is not on the server anymore. Resync the library from Settings"
                .to_string(),
            40 | 41 => "The server rejected the request. Check the server credentials in Settings"
                .to_string(),
            50 => "This account is not allowed to play this track".to_string(),
            60 => "The server requires a subscription to play this track".to_string(),
            _ if message.is_empty() => format!("The server returned error {code}"),
            _ => format!("The server returned error {code}: {message}"),
        };
    StreamFailure {
        message: described,
        detail: if message.is_empty() {
            None
        } else {
            Some(message)
        },
        // Every named Subsonic code above describes the request, not the moment, so a retry
        // produces the same answer. Code 0 is the server's own catch-all and can be a
        // transient fault behind it, so that one is worth another attempt.
        retryable: code == 0,
        subsonic_code: Some(code),
    }
}

fn snippet(head: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(head);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(200).collect())
}

/// Decide what to do with a stream response from its status, content-type and first bytes.
///
/// Deliberately conservative about rejecting: an unfamiliar container with no content-type is
/// passed to the decoder, which knows more formats than this function does. Only a positively
/// identified error envelope, an empty body, or a body that is plainly text is refused.
pub fn classify_stream_response(status: u16, content_type: &str, head: &[u8]) -> StreamVerdict {
    if !(200..300).contains(&status) {
        let message = match status {
            404 => "This track is not on the server anymore".to_string(),
            401 | 403 => {
                "The server rejected the request. Check the server credentials in Settings"
                    .to_string()
            }
            _ => format!("Server returned {status}"),
        };
        return StreamVerdict::Failure(StreamFailure {
            message,
            detail: None,
            // A 4xx will not fix itself on a retry, so surface it now instead of after 30
            // seconds of silent backoff. 408 and 429 are the two that will.
            retryable: status >= 500 || status == 408 || status == 429,
            subsonic_code: None,
        });
    }

    if let Some((code, message)) = parse_subsonic_error(head) {
        return StreamVerdict::Failure(subsonic_failure(code, message));
    }

    if head.is_empty() {
        return StreamVerdict::Failure(StreamFailure {
            message: "The server sent an empty response instead of the track".to_string(),
            detail: None,
            retryable: true,
            subsonic_code: None,
        });
    }

    // Trusted only after the body checks: an audio content-type vouches for nothing when the
    // body is empty or an error envelope, and the prefetch cache would keep either.
    if let Some(codec) = codec_from_content_type(content_type) {
        return StreamVerdict::Audio {
            codec: codec.to_string(),
        };
    }

    if let Some(codec) = codec_from_magic(head) {
        return StreamVerdict::Audio {
            codec: codec.to_string(),
        };
    }

    let ct = content_type.to_lowercase();
    let textual_type =
        ct.starts_with("text/") || ct.contains("json") || ct.contains("xml") || ct.contains("html");
    let textual_body = matches!(first_non_space(head), Some(b'<') | Some(b'{'));
    if textual_type || textual_body {
        let described = if content_type.is_empty() {
            "a text response".to_string()
        } else {
            format!("\"{content_type}\"")
        };
        return StreamVerdict::Failure(StreamFailure {
            message: format!("The server sent {described} instead of the track"),
            detail: snippet(head),
            retryable: false,
            subsonic_code: None,
        });
    }

    StreamVerdict::Audio {
        codec: String::new(),
    }
}

/// Whether a 2xx cover-art response actually carried an image.
///
/// The same Subsonic-on-200 problem as the stream path, with a longer tail: a rejected cover
/// id answers with a JSON envelope, and the proxy caches whatever came back under
/// `{id}:{size}` on disk, so one bad answer outlives the session that got it.
///
/// `content_type` is what the response actually carried, so an absent header is `None` rather
/// than the caller's stand-in: a substituted `image/jpeg` would otherwise vouch for bytes no
/// one declared anything about. A real `image/` header is still accepted without magic bytes,
/// since the decoders know more formats than this does (AVIF, HEIC, SVG) - but not over a body
/// carrying an error envelope, which is the one case the server's own claim is known to be wrong.
pub fn is_image_response(content_type: Option<&str>, head: &[u8]) -> bool {
    if has_image_magic(head) {
        return true;
    }
    match content_type {
        Some(ct) => {
            ct.to_lowercase().starts_with("image/")
                && !String::from_utf8_lossy(head).contains("subsonic-response")
        }
        None => false,
    }
}

fn has_image_magic(head: &[u8]) -> bool {
    head.starts_with(&[0xFF, 0xD8, 0xFF])
        || head.starts_with(b"\x89PNG")
        || head.starts_with(b"GIF87a")
        || head.starts_with(b"GIF89a")
        || head.starts_with(b"BM")
        || (head.len() >= 12 && head.starts_with(b"RIFF") && &head[8..12] == b"WEBP")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn failure(verdict: StreamVerdict) -> StreamFailure {
        match verdict {
            StreamVerdict::Failure(f) => f,
            StreamVerdict::Audio { codec } => panic!("expected a failure, got audio ({codec})"),
        }
    }

    fn codec(verdict: StreamVerdict) -> String {
        match verdict {
            StreamVerdict::Audio { codec } => codec,
            StreamVerdict::Failure(f) => panic!("expected audio, got {}", f.message),
        }
    }

    #[test]
    fn names_the_codec_from_an_audio_content_type() {
        assert_eq!(
            codec(classify_stream_response(200, "audio/flac", b"\x00\x01")),
            "FLAC"
        );
        assert_eq!(
            codec(classify_stream_response(200, "audio/mpeg", b"\x00\x01")),
            "MP3"
        );
        assert_eq!(
            codec(classify_stream_response(200, "audio/ogg", b"\x00\x01")),
            "OGG"
        );
        assert_eq!(
            codec(classify_stream_response(200, "audio/opus", b"\x00\x01")),
            "Opus"
        );
        assert_eq!(
            codec(classify_stream_response(200, "audio/mp4", b"\x00\x01")),
            "AAC"
        );
        assert_eq!(
            codec(classify_stream_response(200, "audio/wav", b"\x00\x01")),
            "WAV"
        );
    }

    #[test]
    fn reads_the_container_magic_when_the_content_type_says_nothing() {
        assert_eq!(
            codec(classify_stream_response(200, "", b"ID3\x04\x00")),
            "MP3"
        );
        assert_eq!(
            codec(classify_stream_response(200, "", b"fLaC\x00")),
            "FLAC"
        );
        assert_eq!(codec(classify_stream_response(200, "", b"OggS\x00")), "OGG");
        assert_eq!(
            codec(classify_stream_response(
                200,
                "application/octet-stream",
                b"RIFF\x00\x00\x00\x00WAVE"
            )),
            "WAV"
        );
        assert_eq!(
            codec(classify_stream_response(
                200,
                "",
                b"\x00\x00\x00\x18ftypM4A "
            )),
            "AAC"
        );
        assert_eq!(
            codec(classify_stream_response(200, "", b"\xff\xfb\x90")),
            "MP3"
        );
    }

    #[test]
    fn names_the_cause_behind_a_json_error_70() {
        let body = br#"{"subsonic-response":{"status":"failed","version":"1.16.1","error":{"code":70,"message":"Song not found"}}}"#;
        let f = failure(classify_stream_response(200, "application/json", body));
        assert_eq!(f.subsonic_code, Some(70));
        assert!(f.message.contains("not on the server"), "{}", f.message);
        assert!(f.message.contains("Resync"), "{}", f.message);
        assert!(!f.retryable);
    }

    #[test]
    fn names_the_cause_behind_a_json_error_40() {
        let body = br#"{"subsonic-response":{"status":"failed","error":{"code":40,"message":"Wrong username or password"}}}"#;
        let f = failure(classify_stream_response(200, "application/json", body));
        assert_eq!(f.subsonic_code, Some(40));
        assert!(f.message.contains("credentials"), "{}", f.message);
        assert!(!f.retryable);
    }

    #[test]
    fn reads_an_xml_error_envelope_too() {
        let body = br#"<?xml version="1.0" encoding="UTF-8"?><subsonic-response status="failed" version="1.16.1"><error code="70" message="Song not found"/></subsonic-response>"#;
        let f = failure(classify_stream_response(200, "text/xml", body));
        assert_eq!(f.subsonic_code, Some(70));
        assert_eq!(f.detail.as_deref(), Some("Song not found"));
    }

    #[test]
    fn treats_the_servers_own_catch_all_code_as_worth_another_try() {
        let body = br#"{"subsonic-response":{"error":{"code":0,"message":"A generic error"}}}"#;
        let f = failure(classify_stream_response(200, "application/json", body));
        assert_eq!(f.subsonic_code, Some(0));
        assert!(f.retryable);
    }

    #[test]
    fn reports_an_unnamed_subsonic_code_with_its_own_message() {
        let body =
            br#"{"subsonic-response":{"error":{"code":30,"message":"Incompatible version"}}}"#;
        let f = failure(classify_stream_response(200, "application/json", body));
        assert_eq!(
            f.message,
            "The server returned error 30: Incompatible version"
        );
    }

    #[test]
    fn refuses_an_html_page_from_a_proxy() {
        let body = b"<!DOCTYPE html><html><body>502 Bad Gateway</body></html>";
        let f = failure(classify_stream_response(200, "text/html", body));
        assert_eq!(f.subsonic_code, None);
        assert!(f.message.contains("instead of the track"), "{}", f.message);
        assert!(f.detail.unwrap().contains("502 Bad Gateway"));
        assert!(!f.retryable);
    }

    #[test]
    fn refuses_an_html_page_that_arrives_without_a_content_type() {
        let body = b"<html><body>hi</body></html>";
        let f = failure(classify_stream_response(200, "", body));
        assert!(f.message.contains("a text response"), "{}", f.message);
    }

    #[test]
    fn treats_an_empty_2xx_body_as_worth_another_try() {
        let f = failure(classify_stream_response(200, "", b""));
        assert!(f.message.contains("empty"), "{}", f.message);
        assert!(f.retryable);
        assert_eq!(f.subsonic_code, None);
    }

    #[test]
    fn refuses_an_empty_body_even_under_an_audio_content_type() {
        let f = failure(classify_stream_response(200, "audio/mpeg", b""));
        assert!(f.message.contains("empty"), "{}", f.message);
        assert!(f.retryable);
    }

    #[test]
    fn names_a_subsonic_error_even_under_an_audio_content_type() {
        let body = br#"{"subsonic-response":{"status":"failed","error":{"code":70,"message":"not found"}}}"#;
        let f = failure(classify_stream_response(200, "audio/mpeg", body));
        assert_eq!(f.subsonic_code, Some(70));
    }

    #[test]
    fn passes_an_unfamiliar_container_to_the_decoder_rather_than_guessing() {
        // The decoder knows more formats than this function does, so only a positively
        // identified error envelope, an empty body or plain text is refused.
        let verdict =
            classify_stream_response(200, "application/octet-stream", b"\x30\x26\xb2\x75");
        assert_eq!(codec(verdict), "");
    }

    #[test]
    fn keeps_the_http_status_messages_it_took_over() {
        let f = failure(classify_stream_response(404, "text/html", b""));
        assert_eq!(f.message, "This track is not on the server anymore");
        assert!(!f.retryable);

        let f = failure(classify_stream_response(401, "", b""));
        assert!(f.message.contains("credentials"), "{}", f.message);
        assert!(!f.retryable);

        let f = failure(classify_stream_response(503, "", b""));
        assert_eq!(f.message, "Server returned 503");
        assert!(f.retryable);

        assert!(failure(classify_stream_response(429, "", b"")).retryable);
        assert!(failure(classify_stream_response(408, "", b"")).retryable);
        assert!(!failure(classify_stream_response(418, "", b"")).retryable);
    }

    #[test]
    fn ignores_a_body_that_is_not_a_subsonic_envelope() {
        // A JSON body from something else entirely is still not audio, but it has no
        // Subsonic code to report and must not be given a made-up one.
        let f = failure(classify_stream_response(
            200,
            "application/json",
            br#"{"ok":true}"#,
        ));
        assert_eq!(f.subsonic_code, None);
    }

    #[test]
    fn accepts_an_image_by_content_type_or_by_magic() {
        assert!(is_image_response(Some("image/jpeg"), b"\xFF\xD8\xFF\xE0"));
        assert!(is_image_response(Some("IMAGE/PNG"), b"anything"));
        assert!(is_image_response(None, &[0xFF, 0xD8, 0xFF, 0xE0]));
        assert!(is_image_response(
            Some("application/octet-stream"),
            b"\x89PNG\r\n\x1a\n"
        ));
        assert!(is_image_response(None, b"GIF89a"));
        assert!(is_image_response(None, b"RIFF\x00\x00\x00\x00WEBPVP8 "));
    }

    #[test]
    fn refuses_a_subsonic_error_envelope_offered_as_cover_art() {
        let body =
            br#"{"subsonic-response":{"error":{"code":70,"message":"Cover art not found"}}}"#;
        assert!(!is_image_response(Some("application/json"), body));
        assert!(!is_image_response(None, body));
        // The header is the server's claim about the body, and a server that rides an error
        // on a 200 is exactly the one whose claim cannot be taken at face value.
        assert!(!is_image_response(Some("image/jpeg"), body));
    }

    #[test]
    fn refuses_a_body_no_one_declared_a_type_for() {
        // The cover proxy substitutes image/jpeg when the header is absent, purely so it has
        // something to store beside the bytes. That substitution must not vouch for them.
        assert!(!is_image_response(None, b""));
        assert!(!is_image_response(
            None,
            b"<html><body>Proxy error</body></html>"
        ));
    }
}
