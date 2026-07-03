use std::collections::HashMap;
use std::net::UdpSocket;
use std::time::{Duration, Instant};

#[derive(Debug, serde::Serialize)]
pub struct RawRenderer {
    pub location: String,
    pub usn: String,
    pub server: String,
}

/// Fully resolved DLNA renderer, ready for use by the frontend.
#[derive(Debug, serde::Serialize)]
pub struct ResolvedRenderer {
    pub name: String,
    pub base_url: String,
    pub av_transport_control_url: String,
    pub rendering_control_url: String,
    pub supports_volume: bool,
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

/// Discover UPnP MediaRenderers on the LAN via SSDP, then fetch and parse
/// each device description. Returns one fully-resolved renderer per unique
/// device (deduped by location URL).
pub fn discover_and_resolve(timeout_ms: u64) -> Result<Vec<ResolvedRenderer>, String> {
    let raw = discover(timeout_ms)?;

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Couldn't set up network client for device discovery: {e}"))?;

    // Dedup by location URL — SSDP returns one entry per service type.
    let mut seen_locations: HashMap<String, ()> = HashMap::new();
    let mut results = Vec::new();

    for r in raw {
        if seen_locations.contains_key(&r.location) {
            continue;
        }
        seen_locations.insert(r.location.clone(), ());

        if let Some(renderer) = fetch_device_description(&client, &r.location) {
            results.push(renderer);
        }
    }

    Ok(results)
}

fn fetch_device_description(
    client: &reqwest::blocking::Client,
    location: &str,
) -> Option<ResolvedRenderer> {
    let resp = client.get(location).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let xml = resp.text().ok()?;

    let base = resolve_base(location, &xml);
    let friendly_name = xml_text(&xml, "friendlyName").unwrap_or_else(|| location.to_string());

    let av_transport_control_url = find_control_url(&xml, "AVTransport", &base)?;
    let rendering_control_url = find_control_url(&xml, "RenderingControl", &base);
    let supports_volume = rendering_control_url.is_some();

    Some(ResolvedRenderer {
        name: friendly_name,
        base_url: base,
        av_transport_control_url,
        rendering_control_url: rendering_control_url.unwrap_or_default(),
        supports_volume,
    })
}

/// Extract text content of the first occurrence of a tag.
fn xml_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let start = xml.find(&open)?;
    let after_open = xml[start..].find('>')? + start + 1;
    let end = xml[after_open..].find(&close)? + after_open;
    Some(xml[after_open..end].trim().to_string())
}

/// Find the controlURL for a given serviceType, resolved to an absolute URL.
fn find_control_url(xml: &str, service_type: &str, base: &str) -> Option<String> {
    // Find each <service> block and look for one whose <serviceType> contains service_type.
    let mut search = xml;
    while let Some(svc_start) = search.find("<service>") {
        let rest = &search[svc_start..];
        let svc_end = rest.find("</service>").unwrap_or(rest.len());
        let svc_block = &rest[..svc_end];

        let stype = xml_text(svc_block, "serviceType").unwrap_or_default();
        if stype.contains(service_type) {
            if let Some(ctrl) = xml_text(svc_block, "controlURL") {
                if ctrl.starts_with("http") {
                    return Some(ctrl);
                }
                let sep = if ctrl.starts_with('/') { "" } else { "/" };
                return Some(format!("{base}{sep}{ctrl}"));
            }
        }

        search = &search[svc_start + "<service>".len()..];
    }
    None
}

/// Derive the base URL: use <URLBase> if present, otherwise extract scheme+host from location.
fn resolve_base(location: &str, xml: &str) -> String {
    if let Some(base) = xml_text(xml, "URLBase") {
        return base.trim_end_matches('/').to_string();
    }
    // Fall back to scheme://host:port from the location URL.
    if let Some(after_scheme) = location.find("://") {
        let rest = &location[after_scheme + 3..];
        let host_end = rest.find('/').unwrap_or(rest.len());
        return format!("{}://{}", &location[..after_scheme], &rest[..host_end]);
    }
    location.to_string()
}

/// SSDP M-SEARCH — returns raw responses (one per service type advertisement).
pub fn discover(timeout_ms: u64) -> Result<Vec<RawRenderer>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Couldn't open a network socket for device discovery: {e}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|e| format!("Couldn't configure device discovery socket: {e}"))?;

    let target: std::net::SocketAddr = SSDP_ADDR
        .parse()
        .expect("SSDP_ADDR is a valid hardcoded address");

    // If both search requests fail to send (e.g. blocked by firewall or
    // missing local-network permission), there's no point listening — every
    // response would be silently missing and look like "no devices found."
    let sent_av_transport = socket.send_to(M_SEARCH_AV_TRANSPORT.as_bytes(), target);
    let sent_renderer = socket.send_to(M_SEARCH_RENDERER.as_bytes(), target);
    if let (Err(e), Err(_)) = (&sent_av_transport, &sent_renderer) {
        return Err(format!(
            "Couldn't send device discovery request — check your firewall or local network permissions: {e}"
        ));
    }

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

    Ok(seen.into_values().collect())
}

fn parse_response(text: &str) -> Option<RawRenderer> {
    let first_line = text.lines().next()?;
    if !first_line.contains("200") {
        return None;
    }

    let mut location = String::new();
    let mut usn = String::new();
    let mut server = String::new();

    for line in text.lines() {
        let Some(colon) = line.find(':') else {
            continue;
        };
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
