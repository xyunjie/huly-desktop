mod keychain;
mod mcp;
mod probe;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            keychain::keychain_save_session,
            keychain::keychain_load_session,
            keychain::keychain_clear_session,
            keychain::keychain_save_ca,
            keychain::keychain_load_ca,
            keychain::keychain_clear_ca,
            probe::probe_server,
            mcp::mcp_get_config,
            mcp::mcp_regenerate_token,
            mcp::mcp_respond,
            mcp::mcp_bind_window
        ])
        .setup(|app| {
            mcp::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
