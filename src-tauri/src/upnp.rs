use std::collections::HashMap;
use std::net::UdpSocket;
use std::time::{Duration, Instant};

#[derive(Debug, serde::Serialize)]
pub struct RawRenderer {
    pub location: String,
    pub usn: String,
    pub server: String,
}

const SSDP_ADDR: &str = "239.255.255.250:1900";

const M_SEARCH_AV_TRANSPORT: &str = "M-SEARCH * HTTP/1.1\r\n\
     HOST: 239.255.255.250:1900\r\n\
     MAN: \"ssdp:discover\"\r\n\
     MX: 3\r\n\
     ST: urn:schemas-upnp-org:service:AVTransport:1\r\n\
     \r\n";

const M_SEARCH_RENDERER: &str = "M-SEARCH * HTTP/1.1\r\n\
     HOST: 239.255.255.250:1900\r\n\
     MAN: \"ssdp:discover\"\r\n\
     MX: 3\r\n\
     ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\
     \r\n";

/// Discover UPnP MediaRenderers on the LAN via SSDP.
/// Returns one entry per unique USN. `timeout_ms` is the total listen window.
pub fn discover(timeout_ms: u64) -> Vec<RawRenderer> {
    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    if socket
        .set_read_timeout(Some(Duration::from_millis(500)))
        .is_err()
    {
        return vec![];
    }

    let target: std::net::SocketAddr = match SSDP_ADDR.parse() {
        Ok(a) => a,
        Err(_) => return vec![],
    };

    // Send both search types; ignore send errors (network may not be available).
    let _ = socket.send_to(M_SEARCH_AV_TRANSPORT.as_bytes(), target);
    let _ = socket.send_to(M_SEARCH_RENDERER.as_bytes(), target);

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut seen: HashMap<String, RawRenderer> = HashMap::new();
    let mut buf = [0u8; 4096];

    loop {
        if Instant::now() >= deadline {
            break;
        }
        match socket.recv_from(&mut buf) {
            Ok((n, _)) => {
                if let Ok(text) = std::str::from_utf8(&buf[..n]) {
                    if let Some(r) = parse_response(text) {
                        // Dedup by USN; prefer AVTransport entries which arrive first.
                        seen.entry(r.usn.clone()).or_insert(r);
                    }
                }
            }
            Err(ref e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(_) => break,
        }
    }

    seen.into_values().collect()
}

fn parse_response(text: &str) -> Option<RawRenderer> {
    // Only process 200 OK SSDP responses.
    let first_line = text.lines().next()?;
    if !first_line.contains("200") {
        return None;
    }

    let mut location = String::new();
    let mut usn = String::new();
    let mut server = String::new();

    for line in text.lines() {
        // Header matching is case-insensitive per HTTP spec.
        let Some(colon) = line.find(':') else { continue };
        let key = line[..colon].trim().to_lowercase();
        let val = line[colon + 1..].trim();
        match key.as_str() {
            "location" => location = val.to_string(),
            "usn" => usn = val.to_string(),
            "server" => server = val.to_string(),
            _ => {}
        }
    }

    if location.is_empty() {
        return None;
    }

    Some(RawRenderer {
        location: location.clone(),
        usn: if usn.is_empty() { location } else { usn },
        server,
    })
}
