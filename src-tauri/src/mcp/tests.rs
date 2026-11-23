use super::*;

#[test]
fn streamable_http_handshake_and_token_rotation() {
    tauri::async_runtime::block_on(async {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let state = Arc::new(McpState::new(Ok(port), Ok("old-token".into())));
        let app = router(state.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let http = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let endpoint = format!("http://127.0.0.1:{port}/mcp");
        let post = |token: &str, msg: Value| {
            http.post(&endpoint)
                .bearer_auth(token)
                .header("accept", "application/json, text/event-stream")
                .json(&msg)
        };
        let ping = json!({ "jsonrpc": "2.0", "id": 2, "method": "ping" });

        let init = post("old-token", json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": "test", "version": "1" } } }))
            .send().await.unwrap();
        assert_eq!(init.status(), StatusCode::OK);
        assert_eq!(
            init.json::<Value>().await.unwrap()["result"]["protocolVersion"],
            "2025-03-26"
        );
        for msg in [
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            json!({ "jsonrpc": "2.0", "id": 1, "result": {} }),
        ] {
            let notification = post("old-token", msg)
                .header("mcp-protocol-version", "2025-03-26")
                .send()
                .await
                .unwrap();
            assert_eq!(notification.status(), StatusCode::ACCEPTED);
            assert!(notification.bytes().await.unwrap().is_empty());
        }
        let get = http
            .get(&endpoint)
            .header("accept", "text/event-stream")
            .send()
            .await
            .unwrap();
        assert_eq!(get.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(get.headers()[header::ALLOW], "POST");
        let origin = post("old-token", ping.clone())
            .header(header::ORIGIN, "https://example.invalid")
            .send()
            .await
            .unwrap();
        assert_eq!(origin.status(), StatusCode::FORBIDDEN);
        let version = post("old-token", ping.clone())
            .header("mcp-protocol-version", "2000-01-01")
            .send()
            .await
            .unwrap();
        assert_eq!(version.status(), StatusCode::BAD_REQUEST);
        let invalid = post("old-token", Value::Null).send().await.unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            invalid.json::<Value>().await.unwrap()["error"]["code"],
            -32600
        );

        assert!(state
            .rotate_token(|_| Err("could not save".into()))
            .is_err());
        assert_eq!(
            post("old-token", ping.clone())
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        let mut saved = String::new();
        state
            .rotate_token(|token| {
                saved = token.to_owned();
                Ok(())
            })
            .unwrap();
        assert_eq!(
            post("old-token", ping.clone())
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let good = post(&saved, ping).send().await.unwrap();
        assert_eq!(good.status(), StatusCode::OK);
        assert_eq!(
            good.json::<Value>().await.unwrap(),
            json!({ "jsonrpc": "2.0", "id": 2, "result": {} })
        );
        assert!(state.pending.lock().unwrap().is_empty());
        server.abort();
    });
}
