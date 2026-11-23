use keyring::Entry;

const SERVICE: &str = "Huly Desk";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|_| "钥匙串不可用。".to_string())
}

fn save(account: &str, secret: &str) -> Result<(), String> {
    entry(account)?.set_password(secret).map_err(|_| "无法写入钥匙串。".to_string())
}

fn load(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("无法读取钥匙串。".to_string()),
    }
}

fn clear(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("无法清除钥匙串。".to_string()),
    }
}

#[tauri::command]
pub fn keychain_save_session(secret: String) -> Result<(), String> {
    if secret.trim().is_empty() {
        return Err("没有可保存的登录信息。".to_string());
    }
    save("session", &secret)
}

#[tauri::command]
pub fn keychain_load_session() -> Result<Option<String>, String> {
    load("session")
}

#[tauri::command]
pub fn keychain_clear_session() -> Result<(), String> {
    clear("session")
}

#[tauri::command]
pub fn keychain_save_ca(pem: String) -> Result<(), String> {
    let trimmed = pem.trim();
    if trimmed.is_empty() {
        return clear("custom-ca");
    }
    if !trimmed.contains("BEGIN CERTIFICATE") {
        return Err("证书需要是 PEM 格式。".to_string());
    }
    save("custom-ca", trimmed)
}

#[tauri::command]
pub fn keychain_load_ca() -> Result<Option<String>, String> {
    load("custom-ca")
}

#[tauri::command]
pub fn keychain_clear_ca() -> Result<(), String> {
    clear("custom-ca")
}

pub fn keychain_save_mcp_token(token: &str) -> Result<(), String> {
    save("mcp-token", token)
}

pub fn keychain_load_mcp_token() -> Result<Option<String>, String> {
    load("mcp-token")
}
