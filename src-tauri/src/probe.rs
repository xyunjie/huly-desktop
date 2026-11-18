use reqwest::Certificate;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResponse {
    accounts_url: String,
    collaborator_url: String,
    files_url: Option<String>,
    upload_url: Option<String>,
}

#[tauri::command]
pub async fn probe_server(
    url: String,
    ca_pem: Option<String>,
    trust_server_cert: bool,
) -> Result<ProbeResponse, String> {
    let config_url = config_url(&url)?;
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none());
    if trust_server_cert {
        builder = builder.danger_accept_invalid_certs(true);
    }
    if let Some(pem) = ca_pem.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        for certificate in certificates(pem)? {
            builder = builder.add_root_certificate(certificate);
        }
    }
    let client = builder.build().map_err(|_| "无法创建探测请求。".to_string())?;
    let response = client
        .get(&config_url)
        .send()
        .await
        .map_err(|_| "读不到服务器的 /config.json。请检查地址、端口和证书。".to_string())?;
    if !response.status().is_success() {
        return Err(format!("config.json 返回 {}", response.status()));
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "config.json 无法解析。".to_string())?;
    let accounts_url = required_url(&body, "ACCOUNTS_URL")?;
    let collaborator_url = required_url(&body, "COLLABORATOR_URL")?;
    Ok(ProbeResponse {
        accounts_url,
        collaborator_url,
        files_url: optional_url(&body, "FILES_URL"),
        upload_url: optional_url(&body, "UPLOAD_URL"),
    })
}

fn config_url(server: &str) -> Result<String, String> {
    let trimmed = server.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("请填写服务器地址。".to_string());
    }
    if trimmed.contains('@') {
        return Err("地址里不要写账号或密码。".to_string());
    }
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| "服务器地址无法解析。".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("服务器地址需要以 http:// 或 https:// 开头。".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("地址里不要写账号或密码。".to_string());
    }
    Ok(format!("{trimmed}/config.json"))
}

fn required_url(body: &serde_json::Value, key: &str) -> Result<String, String> {
    optional_url(body, key).ok_or_else(|| format!("config.json 缺少 {key}。"))
}

fn optional_url(body: &serde_json::Value, key: &str) -> Option<String> {
    body.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn certificates(pem: &str) -> Result<Vec<Certificate>, String> {
    let mut certificates = Vec::new();
    let mut current = String::new();
    for line in pem.lines() {
        current.push_str(line);
        current.push('\n');
        if line.contains("END CERTIFICATE") {
            let certificate = Certificate::from_pem(current.as_bytes()).map_err(|_| "证书不是有效的 PEM。".to_string())?;
            certificates.push(certificate);
            current.clear();
        }
    }
    if certificates.is_empty() {
        return Err("没有读到证书。".to_string());
    }
    Ok(certificates)
}
