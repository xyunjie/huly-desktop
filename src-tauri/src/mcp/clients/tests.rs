use super::*;

fn config(port: u16, token: &str) -> McpConfig {
    McpConfig {
        port,
        token: token.into(),
    }
}

#[test]
fn codex_edits_only_huly_and_keeps_a_backup_even_on_first_add() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    let original = "model = \"gpt-5\"\n\n[profiles.dev] # keep\nmodel = \"gpt-5-mini\"\n[mcp_servers.other]\nurl = \"http://localhost\"\n";
    fs::write(&path, original).unwrap();
    let old = config(41790, "first");
    let (status, installed) = Format::Codex.edit(Some(original), &old).unwrap();
    assert_eq!(status, Status::Missing);
    let backup = write_config(&path, Some(original), &installed, true)
        .unwrap()
        .unwrap();
    assert_eq!(fs::read_to_string(backup).unwrap(), original);
    assert_eq!(
        Format::Codex.edit(Some(&installed), &old).unwrap().0,
        Status::Current
    );
    let original = format!("[mcp_servers.huly_desk]\nurl = \"http://127.0.0.1:41790/mcp\"\nhttp_headers = {{ Authorization = \"Bearer first\", Extra = \"keep\" }}\n{original}");
    let (status, updated) = Format::Codex
        .edit(Some(&original), &config(41791, "next"))
        .unwrap();
    assert_eq!(status, Status::Stale);
    assert!(updated.contains("[profiles.dev] # keep\nmodel = \"gpt-5-mini\""));
    assert!(updated.contains("[mcp_servers.other]"));
    assert!(updated.contains("Extra = \"keep\""));
    assert!(updated.contains("Bearer next"));
    assert!(updated.parse::<DocumentMut>().is_ok());
}

#[test]
fn opencode_updates_v2_jsonc_without_removing_other_entries_or_comments() {
    let previous = r#"{
      // Keep my settings
      "mcp": { "servers": { "other": { "type": "local", "command": ["run-other"] }, }, },
      "mcpServers": { "huly-desk": { "url": "http://127.0.0.1:41790/mcp", "headers": { "Authorization": "Bearer old" } } },
    }"#;
    let config = config(41791, "next");
    let (status, edited) = Format::OpenCode.edit(Some(previous), &config).unwrap();
    assert_eq!(status, Status::Stale);
    assert!(edited.contains("// Keep my settings"));
    assert!(edited.contains("run-other"));
    assert!(!edited.contains("mcpServers"));
    let doc = CstRootNode::parse(&edited, &ParseOptions::default())
        .unwrap()
        .object_value()
        .unwrap()
        .to_serde_value()
        .unwrap();
    let entry = &doc["mcp"]["servers"][NAME];
    assert_eq!(entry["type"], "remote");
    assert_eq!(
        entry["headers"]["Authorization"],
        "Bearer {file:./huly-desk.mcp-token}"
    );
    assert_eq!(entry["oauth"], false);
    assert_eq!(
        Format::OpenCode.edit(Some(&edited), &config).unwrap().0,
        Status::Current
    );
}

#[test]
fn opencode_repairs_its_rotated_token_without_rewriting_the_config() {
    let dir = tempfile::tempdir().unwrap();
    let file = ClientFile {
        path: dir.path().join("opencode.jsonc"),
        format: Format::OpenCode,
    };
    let first = config(41790, "old-test-secret");
    let rotated = config(41790, "new-test-secret");
    assert_eq!(file.status(&first).state, Status::Missing);
    file.install(&first).unwrap();
    assert_eq!(file.status(&first).state, Status::Current);
    let config_text = fs::read_to_string(&file.path).unwrap();
    assert!(!config_text.contains(&first.token));
    assert_eq!(file.status(&rotated).state, Status::Stale);
    file.install(&rotated).unwrap();
    assert_eq!(file.status(&rotated).state, Status::Current);
    assert_eq!(fs::read_to_string(&file.path).unwrap(), config_text);
    assert_eq!(
        fs::read_to_string(file.token_file().unwrap()).unwrap(),
        rotated.token
    );
}

#[test]
fn json_setup_uses_the_right_scope_and_refuses_bad_existing_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested/.claude.json");
    let config = config(41790, "a");
    let (_, output) = Format::ClaudeCode.edit(None, &config).unwrap();
    let doc: serde_json::Value = serde_json::from_str(&output).unwrap();
    assert_eq!(doc["mcpServers"][NAME]["type"], "http");
    assert_eq!(doc["mcpServers"][NAME]["url"], config.url());
    assert_eq!(
        doc["mcpServers"][NAME]["headers"]["Authorization"],
        "Bearer a"
    );
    assert!(write_config(&path, None, &output, true).unwrap().is_none());
    assert!(write_config(&path, None, "not a new config", true).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), output);
    assert!(Format::ClaudeCode.edit(Some("{broken"), &config).is_err());
    assert!(Format::Json
        .edit(Some(r#"{"mcpServers":null}"#), &config)
        .is_err());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o077, 0);
    }
}
