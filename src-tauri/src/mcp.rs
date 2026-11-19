use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode};
use axum::response::Response;
use axum::routing::{any, post};
use axum::Router;
use rand::RngCore;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri::WebviewWindow;
use tokio::sync::oneshot;

/// Shared MCP server state: bearer token and pending webview requests.
struct McpState {
    token: String,
    /// Actual bound port; 0 until the server picks one.
    port: AtomicU16,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    seq: AtomicU64,
    window: Mutex<Option<WebviewWindow>>,
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[tauri::command]
pub fn mcp_get_config(app: AppHandle) -> Result<Value, String> {
    let token = match super::keychain::keychain_load_mcp_token() {
        Ok(Some(existing)) => existing,
        Ok(None) => {
            let token = random_token();
            super::keychain::keychain_save_mcp_token(token.clone())?;
            token
        }
        Err(reason) => return Err(reason),
    };
    let port = app
        .state::<Arc<McpState>>()
        .port
        .load(Ordering::Relaxed);
    Ok(serde_json::json!({ "port": port, "token": token }))
}

#[tauri::command]
pub fn mcp_regenerate_token() -> Result<Value, String> {
    let token = random_token();
    super::keychain::keychain_save_mcp_token(token.clone())?;
    Ok(serde_json::json!({ "token": token }))
}

/// The webview answers a forwarded MCP request with this command.
#[tauri::command]
pub fn mcp_respond(app: AppHandle, seq: u64, body: Value) -> Result<(), String> {
    let state = app.state::<Arc<McpState>>();
    if let Some(sender) = state.pending.lock().unwrap().remove(&seq) {
        let _ = sender.send(body);
    }
    Ok(())
}

/// Bind the webview window so Rust can emit requests to it.
#[tauri::command]
pub fn mcp_bind_window(app: AppHandle) -> Result<(), String> {
    let state = app.state::<Arc<McpState>>();
    if let Some(window) = app.get_webview_window("main") {
        *state.window.lock().unwrap() = Some(window);
    }
    Ok(())
}

async fn handle_mcp(
    State(state): State<Arc<McpState>>,
    headers: axum::http::HeaderMap,
    body: String,
) -> Response {
    // Bearer token check; loopback only is enforced by the bind address.
    let auth = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if auth != format!("Bearer {}", state.token) {
        return json_response(
            StatusCode::UNAUTHORIZED,
            serde_json::json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32001, "message": "无效的 MCP 令牌。" } }),
        );
    }

    let parsed: Result<Value, _> = serde_json::from_str(&body);
    let request = match parsed {
        Ok(value) => value,
        Err(_) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "请求体不是有效的 JSON。" } }),
            );
        }
    };

    let window = state.window.lock().unwrap().clone();
    let Some(window) = window else {
        return json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            serde_json::json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32002, "message": "界面尚未就绪。" } }),
        );
    };

    let seq = state.seq.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel::<Value>();
    state.pending.lock().unwrap().insert(seq, tx);

    if let Err(reason) = window.emit("mcp-request", serde_json::json!({ "seq": seq, "body": request })) {
        state.pending.lock().unwrap().remove(&seq);
        return json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            serde_json::json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32002, "message": format!("无法转发请求：{reason}") } }),
        );
    }

    match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
        Ok(Ok(body)) => json_response(StatusCode::OK, body),
        _ => {
            state.pending.lock().unwrap().remove(&seq);
            json_response(
                StatusCode::GATEWAY_TIMEOUT,
                serde_json::json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32003, "message": "请求超时。" } }),
            )
        }
    }
}

fn json_response(status: StatusCode, body: Value) -> Response {
    Response::builder()
        .status(status)
        .header("content-type", HeaderValue::from_static("application/json"))
        .body(Body::from(body.to_string()))
        .unwrap()
}

pub fn spawn(app: AppHandle) {
    const BASE_PORT: u16 = 41790;
    const MAX_ATTEMPTS: u16 = 20;
    let token = match super::keychain::keychain_load_mcp_token() {
        Ok(Some(existing)) if existing.len() == 64 => existing,
        _ => {
            let token = random_token();
            let _ = super::keychain::keychain_save_mcp_token(token.clone());
            token
        }
    };
    let state = Arc::new(McpState {
        token,
        port: AtomicU16::new(0),
        pending: Mutex::new(HashMap::new()),
        seq: AtomicU64::new(1),
        window: Mutex::new(None),
    });
    app.manage(state.clone());

    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/mcp", post(handle_mcp))
            .route("/mcp", any(|| async { json_response(StatusCode::METHOD_NOT_ALLOWED, serde_json::json!({ "error": "Method Not Allowed" })) }))
            .with_state(state.clone());
        // First free port from 41790; another Huly Desk instance or a
        // foreign app may hold the base port.
        for offset in 0..MAX_ATTEMPTS {
            let port = BASE_PORT + offset;
            match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
                Ok(listener) => {
                    state.port.store(port, Ordering::Relaxed);
                    let _ = axum::serve(listener, router).await;
                    return;
                }
                Err(_) => continue,
            }
        }
    });
}

// ---- One-click client setup -------------------------------------------------

fn home() -> Result<std::path::PathBuf, String> {
    std::env::var_os("HOME").map(std::path::PathBuf::from).ok_or_else(|| "无法确定用户目录。".to_string())
}

#[derive(serde::Serialize)]
pub struct ClientStatus {
    pub installed: bool,
    /// Config/tool presence result, shown in the UI when not installed.
    pub note: String,
}

fn claude_code_status() -> Result<ClientStatus, String> {
    let out = std::process::Command::new("claude")
        .arg("mcp")
        .arg("list")
        .output()
        .map_err(|_| "未检测到 claude 命令。".to_string())?;
    let text = String::from_utf8_lossy(&out.stdout) + String::from_utf8_lossy(&out.stderr);
    Ok(ClientStatus { installed: text.contains("huly-desk"), note: if text.contains("huly-desk") { "已在 claude mcp 列表中".into() } else { "未在 claude mcp 列表中".into() } })
}

fn cursor_config_path() -> Result<std::path::PathBuf, String> {
    Ok(home()?.join(".cursor/mcp.json"))
}

fn cursor_status() -> Result<ClientStatus, String> {
    let path = cursor_config_path()?;
    if !path.exists() {
        return Ok(ClientStatus { installed: false, note: "配置文件不存在".into() });
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(ClientStatus { installed: raw.contains("huly-desk"), note: if raw.contains("huly-desk") { "已写入 ~/.cursor/mcp.json".into() } else { "未写入 ~/.cursor/mcp.json".into() } })
}

fn json_config_path(client: &str) -> Result<std::path::PathBuf, String> {
    let h = home()?;
    Ok(match client {
        "opencode" => h.join(".config/opencode/opencode.json"),
        "windsurf" => h.join(".codeium/windsurf/mcp_config.json"),
        "claude-desktop" => h.join("Library/Application Support/Claude/claude_desktop_config.json"),
        _ => return Err(format!("未知客户端 {client}")),
    })
}

fn toml_config_path() -> Result<std::path::PathBuf, String> {
    Ok(home()?.join(".codex/config.toml"))
}

fn file_status(path: &std::path::Path, label: &str) -> Result<ClientStatus, String> {
    if !path.exists() {
        return Ok(ClientStatus { installed: false, note: format!("{label} 不存在，添加时会创建") });
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(ClientStatus { installed: raw.contains("huly-desk"), note: if raw.contains("huly-desk") { format!("已写入 {label}") } else { format!("未写入 {label}") } })
}

#[tauri::command]
pub fn mcp_client_status(client: String) -> Result<ClientStatus, String> {
    match client.as_str() {
        "claude-code" => claude_code_status(),
        "cursor" => cursor_status(),
        "codex" => file_status(&toml_config_path()?, "~/.codex/config.toml"),
        "opencode" => file_status(&json_config_path("opencode")?, "opencode.json"),
        "windsurf" => file_status(&json_config_path("windsurf")?, "mcp_config.json"),
        "claude-desktop" => file_status(&json_config_path("claude-desktop")?, "claude_desktop_config.json"),
        _ => Err(format!("未知客户端 {client}")),
    }
}

/// Merge `mcpServers.huly-desk` into a JSON MCP config file, with backup.
fn write_json_client(path: &std::path::Path, server: serde_json::Value) -> Result<String, String> {
    let mut root: serde_json::Value = if path.exists() {
        let raw = std::fs::read_to_string(path).map_err(|e| format!("读取失败：{e}"))?;
        serde_json::from_str(&raw).map_err(|_| "现有配置不是有效的 JSON，已取消写入。".to_string())?
    } else {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        }
        serde_json::json!({})
    };
    if !root.is_object() {
        return Err("现有配置不是 JSON 对象，已取消写入。".to_string());
    }
    if path.exists() {
        let backup = path.with_extension("json.hulydesk-backup");
        std::fs::copy(path, &backup).map_err(|e| format!("备份失败：{e}"))?;
    }
    root.as_object_mut()
        .unwrap()
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("mcpServers 不是对象，已取消写入。".to_string())?
        .insert("huly-desk".into(), server);
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("写入失败：{e}"))?;
    Ok(format!("已写入 {}（原文件已备份）", path.display()))
}

fn write_codex_config(url: &str, token: &str) -> Result<String, String> {
    let path = toml_config_path()?;
    let block = format!(
        "\n[mcp_servers.huly_desk]\nurl = \"{url}\"\nhttp_headers = {{ \"Authorization\" = \"Bearer {token}\" }}\n"
    );
    let existing = if path.exists() { std::fs::read_to_string(&path).map_err(|e| e.to_string())? } else { String::new() };
    if existing.contains("[mcp_servers.huly_desk]") {
        // Replace the existing table (up to the next table header or EOF).
        let mut out = String::new();
        let mut skipping = false;
        for line in existing.lines() {
            if line.trim_start().starts_with("[mcp_servers.huly_desk]") {
                skipping = true;
                continue;
            }
            if skipping && line.trim_start().starts_with('[') && line.trim_start().ends_with(']') {
                skipping = false;
            }
            if !skipping { out.push_str(line); out.push('\n'); }
        }
        let out = out + &block;
        let backup = path.with_extension("toml.hulydesk-backup");
        std::fs::copy(&path, &backup).map_err(|e| format!("备份失败：{e}"))?;
        std::fs::write(&path, out).map_err(|e| format!("写入失败：{e}"))?;
        return Ok(format!("已更新 {}（原文件已备份）", path.display()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(&path, existing + &block).map_err(|e| format!("写入失败：{e}"))?;
    Ok(format!("已写入 {}（新增配置段）", path.display()))
}

#[tauri::command]
pub fn mcp_add_to_client(app: AppHandle, client: String, url: String, token: String) -> Result<String, String> {
    if !url.starts_with("http://127.0.0.1:") {
        return Err("服务地址异常，已取消。".to_string());
    }
    match client.as_str() {
        "claude-code" => {
            let header = format!("Authorization: Bearer {token}");
            let out = std::process::Command::new("claude")
                .args(["mcp", "add", "--transport", "http", "huly-desk", &url, "--header", &header])
                .output()
                .map_err(|_| "未检测到 claude 命令，请先安装 Claude Code。".to_string())?;
            if out.status.success() {
                Ok("已通过 claude mcp add 添加（用户级）。".to_string())
            } else {
                Err(format!("claude 命令失败：{}", String::from_utf8_lossy(&out.stderr)))
            }
        }
        "cursor" => {
            // cursor://anysphere.cursor-deeplink/mcp/install?name=...&config=base64(json)
            let config = serde_json::json!({ "url": url, "headers": { "Authorization": format!("Bearer {token}") } });
            let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
            let b64 = base64_encode(json.as_bytes());
            let link = format!("cursor://anysphere.cursor-deeplink/mcp/install?name=huly-desk&config={b64}");
            open_url(&app, &link)
        }
        "codex" => write_codex_config(&url, &token),
        "opencode" | "windsurf" | "claude-desktop" => {
            let server = serde_json::json!({ "url": url, "headers": { "Authorization": format!("Bearer {token}") } });
            let path = json_config_path(&client)?;
            write_json_client(&path, server)
        }
        _ => Err(format!("未知客户端 {client}")),
    }
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

fn open_url(_app: &AppHandle, url: &str) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(url).output();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd").args(["/C", "start", url]).output();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(url).output();
    match result {
        Ok(output) if output.status.success() => Ok("已打开 Cursor，请在 Cursor 中确认安装。".to_string()),
        Ok(output) => Err(format!("打开失败：{}", String::from_utf8_lossy(&output.stderr))),
        Err(e) => Err(format!("打开失败：{e}")),
    }
}
