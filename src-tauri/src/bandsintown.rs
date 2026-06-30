const APP_ID: &str = "js_app_id";

#[derive(serde::Serialize, Default)]
pub struct BandsintownEvent {
    pub datetime: String,
    pub venue_name: String,
    pub venue_city: String,
    pub venue_region: String,
    pub venue_country: String,
    pub url: String,
    pub lineup: Vec<String>,
}

/// Fetch upcoming Bandsintown events for an artist. Returns empty on any error.
#[tauri::command]
pub async fn fetch_bandsintown_events(artist_name: String) -> Result<Vec<BandsintownEvent>, String> {
    let trimmed = artist_name.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }
    let encoded: String = url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect();
    let url = format!(
        "https://rest.bandsintown.com/artists/{}/events?app_id={}",
        encoded, APP_ID
    );
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(vec![]),
    };
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };
    if !resp.status().is_success() {
        return Ok(vec![]);
    }
    let raw: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Ok(vec![]),
    };
    let arr = match raw.as_array() {
        Some(a) => a,
        None => return Ok(vec![]),
    };
    let mut out: Vec<BandsintownEvent> = Vec::with_capacity(arr.len().min(20));
    for item in arr.iter().take(20) {
        let venue = item.get("venue").cloned().unwrap_or(serde_json::Value::Null);
        let lineup = item
            .get("lineup")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
            .unwrap_or_default();
        out.push(BandsintownEvent {
            datetime: item.get("datetime").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            venue_name: venue.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            venue_city: venue.get("city").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            venue_region: venue.get("region").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            venue_country: venue.get("country").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            url: item.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            lineup,
        });
    }
    Ok(out)
}
