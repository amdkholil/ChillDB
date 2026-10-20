use std::{
    fs,
    path::Path,
    time::Duration,
};

use serde_json::json;

const MAX_DESCRIPTION: usize = 3900;

pub async fn report(webhook_path: &Path, context: &str, message: &str) -> Result<(), String> {
    let message = message.trim();
    if message.is_empty() {
        return Ok(());
    }
    let Some(url) = webhook_url(webhook_path) else {
        return Ok(());
    };

    let description = message.replace("```", "'''");
    let payload = json!({
        "username": "ChillDB",
        "embeds": [{
            "title": truncate(&format!("ChillDB error · {context}"), 250),
            "description": truncate(&description, MAX_DESCRIPTION),
            "color": 0xEF6B6B,
            "footer": {
                "text": format!(
                    "ChillDB {} · {} {}",
                    env!("CARGO_PKG_VERSION"),
                    std::env::consts::OS,
                    std::env::consts::ARCH
                )
            }
        }]
    });

    let response = reqwest::Client::new()
        .post(url)
        .json(&payload)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| format!("Could not send error report: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Error report was rejected with status {}.",
            response.status()
        ));
    }
    Ok(())
}

fn webhook_url(path: &Path) -> Option<String> {
    if let Ok(url) = std::env::var("CHILLDB_DISCORD_WEBHOOK") {
        let url = url.trim();
        if !url.is_empty() {
            return Some(url.to_string());
        }
    }
    fs::read_to_string(path)
        .ok()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
}

fn truncate(value: &str, max: usize) -> String {
    let mut chars = value.chars();
    let truncated: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}
