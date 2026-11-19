use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode};
use axum::response::Response;
use axum::routing::{any, post};
use axum::Router;
use rand::RngCore;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri::WebviewWindow;
use tokio::sync::oneshot;

/// Shared MCP server state: bearer token and pending webview requests.
struct McpState {
    token: String,
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
pub fn mcp_get_config() -> Result<Value, String> {
    let port = 41790u16;
    let token = match super::keychain::keychain_load_mcp_token() {
        Ok(Some(existing)) => existing,
        Ok(None) => {
            let token = random_token();
            super::keychain::keychain_save_mcp_token(token.clone())?;
            token
        }
        Err(reason) => return Err(reason),
    };
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
    let port = 41790u16;
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
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await;
        match listener {
            Ok(listener) => {
                let _ = axum::serve(listener, router).await;
            }
            Err(_) => {
                // Port busy (another Huly Desk instance). Skip silently:
                // the UI can surface the state via mcp_get_config probe.
            }
        }
    });
}
