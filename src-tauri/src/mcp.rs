pub mod clients;

use axum::body::to_bytes;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{routing::any, Json, Router};
use rand::RngCore;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::sync::oneshot;

const PROTOCOLS: &[&str] = &["2025-06-18", "2025-03-26"];
const MAX_BODY: usize = 1024 * 1024;

struct McpState {
    token: Mutex<Result<String, String>>,
    port: Result<u16, String>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    seq: AtomicU64,
    window: Mutex<Option<WebviewWindow>>,
}

impl McpState {
    fn new(port: Result<u16, String>, token: Result<String, String>) -> Self {
        Self {
            token: Mutex::new(token),
            port,
            pending: Mutex::new(HashMap::new()),
            seq: AtomicU64::new(1),
            window: Mutex::new(None),
        }
    }

    fn rotate_token(&self, save: impl FnOnce(&str) -> Result<(), String>) -> Result<(), String> {
        let mut current = self.token.lock().unwrap();
        let token = random_token();
        save(&token)?;
        *current = Ok(token);
        Ok(())
    }
}

#[derive(Serialize)]
pub struct McpConfig {
    port: u16,
    token: String,
}

impl McpConfig {
    fn url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn load_token() -> Result<String, String> {
    if let Some(token) = super::keychain::keychain_load_mcp_token()? {
        if token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Ok(token);
        }
    }
    let token = random_token();
    super::keychain::keychain_save_mcp_token(&token)?;
    Ok(token)
}

#[tauri::command]
pub fn mcp_get_config(app: AppHandle) -> Result<McpConfig, String> {
    let state = app.state::<Arc<McpState>>();
    let port = state.port.clone()?;
    let token = state.token.lock().unwrap().clone()?;
    Ok(McpConfig { port, token })
}

#[tauri::command]
pub fn mcp_regenerate_token(app: AppHandle) -> Result<McpConfig, String> {
    let state = app.state::<Arc<McpState>>();
    state.port.clone()?;
    state.rotate_token(super::keychain::keychain_save_mcp_token)?;
    mcp_get_config(app)
}

#[tauri::command]
pub fn mcp_respond(app: AppHandle, seq: u64, body: Value) {
    let state = app.state::<Arc<McpState>>();
    if let Some(sender) = state.pending.lock().unwrap().remove(&seq) {
        let _ = sender.send(body);
    };
}

#[tauri::command]
pub fn mcp_bind_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("主窗口尚未就绪。")?;
    *app.state::<Arc<McpState>>().window.lock().unwrap() = Some(window);
    Ok(())
}

fn rpc_error(status: StatusCode, id: Value, code: i32, message: &str) -> Response {
    (
        status,
        Json(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })),
    )
        .into_response()
}

fn allowed_origin(headers: &HeaderMap, port: u16) -> bool {
    let mut origins = headers.get_all(header::ORIGIN).iter();
    let Some(origin) = origins.next() else {
        return true;
    };
    origins.next().is_none()
        && origin.to_str().is_ok_and(|origin| {
            origin == format!("http://127.0.0.1:{port}")
                || origin == format!("http://localhost:{port}")
        })
}

// Remove the pending entry even if the HTTP connection closes before we respond.
struct Pending<'a>(&'a McpState, u64);

impl Drop for Pending<'_> {
    fn drop(&mut self) {
        self.0.pending.lock().unwrap().remove(&self.1);
    }
}

async fn handle_mcp(State(state): State<Arc<McpState>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let headers = parts.headers;
    if !allowed_origin(&headers, state.port.as_ref().copied().unwrap_or_default()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if parts.method != Method::POST {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            [(header::ALLOW, HeaderValue::from_static("POST"))],
        )
            .into_response();
    }

    let authorized = state.token.lock().unwrap().as_ref().is_ok_and(|token| {
        headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split_once(' '))
            .is_some_and(|(scheme, value)| scheme.eq_ignore_ascii_case("Bearer") && value == token)
    });
    if !authorized {
        let mut response = rpc_error(
            StatusCode::UNAUTHORIZED,
            Value::Null,
            -32001,
            "无效的 MCP 令牌。",
        );
        response
            .headers_mut()
            .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
        return response;
    }
    let versions = headers.get_all("mcp-protocol-version");
    if versions.iter().count() > 1
        || versions.iter().any(|version| {
            version
                .to_str()
                .map_or(true, |value| !PROTOCOLS.contains(&value))
        })
    {
        return rpc_error(
            StatusCode::BAD_REQUEST,
            Value::Null,
            -32600,
            "不支持此 MCP 协议版本。",
        );
    }
    if !headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
        })
    {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }

    let body = match to_bytes(body, MAX_BODY).await {
        Ok(body) => body,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let Ok(body) = serde_json::from_slice::<Value>(&body) else {
        return rpc_error(
            StatusCode::BAD_REQUEST,
            Value::Null,
            -32700,
            "请求体不是有效的 JSON。",
        );
    };
    let id = body.get("id");
    let method = body
        .get("method")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let valid_id = id.is_some_and(|id| id.is_string() || id.is_i64() || id.is_u64());
    let valid_request = method.is_some()
        && (id.is_none() || valid_id)
        && body.get("params").is_none_or(Value::is_object)
        && body.get("result").is_none()
        && body.get("error").is_none();
    let valid_reply = body.get("method").is_none()
        && valid_id
        && match (body.get("result"), body.get("error")) {
            (Some(result), None) => result.is_object(),
            (None, Some(error)) => {
                error.get("code").is_some_and(Value::is_i64)
                    && error.get("message").is_some_and(Value::is_string)
            }
            _ => false,
        };
    if body.get("jsonrpc").and_then(Value::as_str) != Some("2.0") || !(valid_request || valid_reply)
    {
        return rpc_error(
            StatusCode::BAD_REQUEST,
            Value::Null,
            -32600,
            "无效的 JSON-RPC 消息。",
        );
    }
    if valid_reply || id.is_none() {
        return StatusCode::ACCEPTED.into_response();
    }
    let id = id.unwrap().clone();
    match method.unwrap() {
        "initialize" => {
            let version = body
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .filter(|version| PROTOCOLS.contains(version))
                .unwrap_or(PROTOCOLS[0]);
            return Json(json!({ "jsonrpc": "2.0", "id": id, "result": {
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "huly-desk", "version": env!("CARGO_PKG_VERSION") }
            } }))
            .into_response();
        }
        "ping" => return Json(json!({ "jsonrpc": "2.0", "id": id, "result": {} })).into_response(),
        "tools/list" | "tools/call" => {}
        _ => return rpc_error(StatusCode::OK, id, -32601, "未知 MCP 方法。"),
    }

    let window = state.window.lock().unwrap().clone();
    let Some(window) = window else {
        return rpc_error(
            StatusCode::SERVICE_UNAVAILABLE,
            id,
            -32002,
            "桌面界面尚未就绪。",
        );
    };
    let seq = state.seq.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    state.pending.lock().unwrap().insert(seq, tx);
    let _pending = Pending(&state, seq);
    if window
        .emit("mcp-request", json!({ "seq": seq, "body": body }))
        .is_err()
    {
        return rpc_error(
            StatusCode::SERVICE_UNAVAILABLE,
            id,
            -32002,
            "无法将请求转发给桌面界面。",
        );
    }
    match tokio::time::timeout(Duration::from_secs(60), rx).await {
        Ok(Ok(Value::Object(mut response))) => {
            response.insert("id".into(), id);
            Json(response).into_response()
        }
        _ => rpc_error(
            StatusCode::GATEWAY_TIMEOUT,
            id,
            -32003,
            "请求超时。如果是写入操作，请先核实结果再重试。",
        ),
    }
}

fn router(state: Arc<McpState>) -> Router {
    Router::new()
        .route("/mcp", any(handle_mcp))
        .with_state(state)
}

pub fn spawn(app: AppHandle) {
    let listener = (41790..41810)
        .find_map(|port| TcpListener::bind(("127.0.0.1", port)).ok())
        .ok_or_else(|| "MCP 无法监听 127.0.0.1:41790–41809；请释放其中一个端口后重启。".to_string())
        .and_then(|listener| {
            listener.set_nonblocking(true).map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            Ok((listener, port))
        });
    let port = listener
        .as_ref()
        .map(|(_, port)| *port)
        .map_err(Clone::clone);
    let state = Arc::new(McpState::new(port, load_token()));
    app.manage(state.clone());
    if let Ok((listener, _)) = listener {
        tauri::async_runtime::spawn(async move {
            if let Ok(listener) = tokio::net::TcpListener::from_std(listener) {
                let _ = axum::serve(listener, router(state)).await;
            }
        });
    }
}

#[cfg(test)]
mod tests;
