use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "io.chilldb.desktop";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSecrets {
    pub password: String,
    pub ssh_secret: String,
}

fn entry(profile_id: &str) -> Result<Entry, String> {
    if profile_id.trim().is_empty() {
        return Err("Cannot store credentials without a profile id".to_string());
    }
    Entry::new(SERVICE, profile_id)
        .map_err(|e| format!("Could not access the OS credential store: {e}"))
}

pub fn save(profile_id: &str, password: &str, ssh_secret: &str) -> Result<(), String> {
    let payload = serde_json::to_string(&StoredSecrets {
        password: password.to_string(),
        ssh_secret: ssh_secret.to_string(),
    })
    .map_err(|e| format!("Could not prepare credentials for storage: {e}"))?;

    entry(profile_id)?
        .set_password(&payload)
        .map_err(|e| format!("Could not save credentials in the OS credential store: {e}"))
}

pub fn load(profile_id: &str) -> Result<Option<StoredSecrets>, String> {
    match entry(profile_id)?.get_password() {
        Ok(payload) => serde_json::from_str(&payload)
            .map(Some)
            .map_err(|e| format!("Saved credentials could not be read: {e}")),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "Could not read credentials from the OS credential store: {error}"
        )),
    }
}

pub fn delete(profile_id: &str) -> Result<(), String> {
    match entry(profile_id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Could not remove credentials from the OS credential store: {error}"
        )),
    }
}
