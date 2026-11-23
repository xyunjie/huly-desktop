use super::{mcp_get_config, McpConfig};
use jsonc_parser::cst::{CstInputValue, CstObject, CstRootNode};
use jsonc_parser::ParseOptions;
use serde::Serialize;
use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use toml_edit::{value, DocumentMut, Item, Table, TableLike};

const NAME: &str = "huly-desk";
const OPENCODE_TOKEN_FILE: &str = "huly-desk.mcp-token";

#[derive(Clone, Copy)]
enum Format {
    Codex,
    OpenCode,
    ClaudeCode,
    Json,
}

struct ClientFile {
    path: PathBuf,
    format: Format,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Missing,
    Current,
    Stale,
    Invalid,
}

#[derive(Serialize)]
pub struct ClientStatus {
    state: Status,
    path: String,
    note: Option<String>,
}

fn env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

fn client_file(app: &AppHandle, client: &str) -> Result<ClientFile, String> {
    let home = app.path().home_dir().map_err(|_| "无法确定用户目录。")?;
    let (path, format) = match client {
        "claude-code" => (
            env_path("CLAUDE_CONFIG_DIR")
                .unwrap_or_else(|| home.clone())
                .join(".claude.json"),
            Format::ClaudeCode,
        ),
        "codex" => (
            env_path("CODEX_HOME")
                .unwrap_or_else(|| home.join(".codex"))
                .join("config.toml"),
            Format::Codex,
        ),
        "opencode" => {
            let dir = env_path("XDG_CONFIG_HOME")
                .unwrap_or_else(|| home.join(".config"))
                .join("opencode");
            let json = dir.join("opencode.json");
            let jsonc = dir.join("opencode.jsonc");
            (
                if json.try_exists().map_err(|e| e.to_string())?
                    || !jsonc.try_exists().map_err(|e| e.to_string())?
                {
                    json
                } else {
                    jsonc
                },
                Format::OpenCode,
            )
        }
        "cursor" => (home.join(".cursor/mcp.json"), Format::Json),
        _ => return Err("此客户端不支持自动配置。".into()),
    };
    Ok(ClientFile { path, format })
}

fn read_config(path: &Path) -> io::Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => match fs::symlink_metadata(path) {
            Err(missing) if missing.kind() == io::ErrorKind::NotFound => Ok(None),
            _ => Err(error),
        },
        Err(error) => Err(error),
    }
}

fn ensure_json_object(parent: &CstObject, name: &str) -> Result<CstObject, String> {
    if parent
        .properties()
        .iter()
        .filter(|prop| prop.decoded_name().as_deref() == Some(name))
        .count()
        > 1
    {
        return Err(format!("配置中有重复的 {name}，未修改现有配置。"));
    }
    parent
        .object_value_or_create(name)
        .ok_or_else(|| format!("{name} 不是 JSON 对象，未修改现有配置。"))
}

fn set_json(object: &CstObject, key: &str, value: impl Into<CstInputValue>) {
    if let Some(prop) = object.get(key) {
        prop.set_value(value.into());
    } else {
        object.append(key, value.into());
    }
}

fn has_legacy_entry(root: &CstObject, key: &str) -> Option<jsonc_parser::cst::CstObjectProp> {
    let prop = root.object_value(key)?.get(NAME)?;
    let entry = root
        .object_value(key)?
        .object_value(NAME)?
        .to_serde_value()?;
    entry["url"]
        .as_str()
        .filter(|url| url.starts_with("http://127.0.0.1:") && url.ends_with("/mcp"))?;
    entry["headers"]["Authorization"]
        .as_str()
        .filter(|value| value.starts_with("Bearer "))?;
    Some(prop)
}

fn edit_json(
    format: Format,
    existing: &str,
    url: &str,
    auth: &str,
) -> Result<(Status, String), String> {
    let open = matches!(format, Format::OpenCode);
    if !open && serde_json::from_str::<serde_json::Value>(existing).is_err() {
        return Err("现有配置不是有效的 JSON，未修改。".into());
    }
    let doc = CstRootNode::parse(
        existing,
        &ParseOptions {
            allow_loose_object_property_names: false,
            allow_missing_commas: false,
            allow_single_quoted_strings: false,
            allow_hexadecimal_numbers: false,
            allow_unary_plus_numbers: false,
            allow_bare_decimal_point_numbers: false,
            allow_non_finite_numbers: false,
            allow_extended_string_escapes: false,
            allow_comments: open,
            allow_trailing_commas: open,
        },
    )
    .map_err(|_| "现有配置不是有效的 JSON/JSONC，未修改。")?;
    let root = doc
        .object_value()
        .ok_or("现有配置不是 JSON 对象，未修改。")?;
    let servers = if open {
        ensure_json_object(&ensure_json_object(&root, "mcp")?, "servers")?
    } else {
        ensure_json_object(&root, "mcpServers")?
    };
    let legacy = if open {
        [
            has_legacy_entry(&root, "mcp"),
            has_legacy_entry(&root, "mcpServers"),
        ]
    } else {
        [None, None]
    };
    let has_legacy_root = legacy[1].is_some();
    if servers
        .properties()
        .iter()
        .filter(|prop| prop.decoded_name().as_deref() == Some(NAME))
        .count()
        > 1
    {
        return Err(format!("配置中有重复的 {NAME}，未修改现有配置。"));
    }
    let previous = servers
        .object_value(NAME)
        .and_then(|object| object.to_serde_value());
    let kind = match format {
        Format::OpenCode => Some("remote"),
        Format::ClaudeCode => Some("http"),
        _ => None,
    };
    if previous.as_ref().is_some_and(|entry| {
        entry["url"].as_str() == Some(url)
            && entry["headers"]["Authorization"].as_str() == Some(auth)
            && kind.is_none_or(|kind| entry["type"].as_str() == Some(kind))
            && (!open || entry["oauth"].as_bool() == Some(false))
            && entry.get("command").is_none()
            && entry.get("serverUrl").is_none()
    }) && legacy.iter().all(Option::is_none)
    {
        return Ok((Status::Current, existing.into()));
    }
    let status = if servers.get(NAME).is_some() || legacy.iter().any(Option::is_some) {
        Status::Stale
    } else {
        Status::Missing
    };
    let server = servers.object_value_or_set(NAME);
    if let Some(kind) = kind {
        set_json(&server, "type", kind);
    }
    if open {
        set_json(&server, "oauth", false);
    }
    for key in ["command", "args", "env", "serverUrl"] {
        if let Some(prop) = server.get(key) {
            prop.remove();
        }
    }
    set_json(&server, "url", url);
    let headers = ensure_json_object(&server, "headers")?;
    set_json(&headers, "Authorization", auth);
    for prop in legacy.into_iter().flatten() {
        prop.remove();
    }
    if has_legacy_root {
        if let Some(prop) = root.get("mcpServers") {
            if root
                .object_value("mcpServers")
                .is_some_and(|object| object.properties().is_empty())
            {
                prop.remove();
            }
        }
    }
    Ok((status, doc.to_string()))
}

fn ensure_toml_table<'a>(
    parent: &'a mut dyn TableLike,
    name: &str,
) -> Result<&'a mut dyn TableLike, String> {
    if !parent.contains_key(name) {
        parent.insert(name, Item::Table(Table::new()));
    }
    parent
        .get_mut(name)
        .and_then(Item::as_table_like_mut)
        .ok_or_else(|| format!("{name} 不是 TOML 表，未修改现有配置。"))
}

fn edit_codex(existing: &str, url: &str, auth: &str) -> Result<(Status, String), String> {
    let mut doc = existing
        .parse::<DocumentMut>()
        .map_err(|_| "现有配置不是有效的 TOML，未修改。")?;
    if !doc.contains_key("mcp_servers") {
        let mut servers = Table::new();
        servers.set_implicit(true);
        doc.insert("mcp_servers", Item::Table(servers));
    }
    let servers = ensure_toml_table(doc.as_table_mut(), "mcp_servers")?;
    let status = if servers.contains_key("huly_desk") {
        Status::Stale
    } else {
        Status::Missing
    };
    let server = ensure_toml_table(servers, "huly_desk")?;
    let current_url = server.get("url").and_then(Item::as_str) == Some(url);
    let other_transport =
        server.contains_key("command") || server.contains_key("bearer_token_env_var");
    if !server.contains_key("http_headers") {
        server.insert(
            "http_headers",
            Item::Value(toml_edit::InlineTable::new().into()),
        );
    }
    let headers = ensure_toml_table(server, "http_headers")?;
    if current_url
        && headers.get("Authorization").and_then(Item::as_str) == Some(auth)
        && !other_transport
    {
        return Ok((Status::Current, existing.into()));
    }
    headers.insert("Authorization", value(auth));
    for key in [
        "command",
        "args",
        "env",
        "env_vars",
        "cwd",
        "bearer_token_env_var",
    ] {
        server.remove(key);
    }
    server.insert("url", value(url));
    Ok((status, doc.to_string()))
}

impl Format {
    fn edit(self, existing: Option<&str>, config: &McpConfig) -> Result<(Status, String), String> {
        let url = config.url();
        let auth = format!("Bearer {}", config.token);
        match self {
            Self::Codex => edit_codex(existing.unwrap_or(""), &url, &auth),
            Self::OpenCode => edit_json(
                self,
                existing.unwrap_or("{\n}\n"),
                &url,
                &format!("Bearer {{file:./{OPENCODE_TOKEN_FILE}}}"),
            ),
            _ => edit_json(self, existing.unwrap_or("{\n}\n"), &url, &auth),
        }
    }
}

fn write_config(
    path: &Path,
    existing: Option<&str>,
    updated: &str,
    backup: bool,
) -> io::Result<Option<PathBuf>> {
    let path = if existing.is_some() {
        path.canonicalize()?
    } else {
        path.to_path_buf()
    };
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("无法确定配置文件所在目录。"))?;
    fs::create_dir_all(parent)?;
    let mut new = tempfile::NamedTempFile::new_in(parent)?;
    new.write_all(updated.as_bytes())?;
    new.as_file().sync_all()?;
    if let Some(existing) = existing {
        if fs::read_to_string(&path)? != existing {
            return Err(io::Error::other("配置文件刚被其他程序修改，请刷新后重试。"));
        }
        let backup_path = if backup {
            let mut name = path.file_name().unwrap_or_default().to_os_string();
            name.push(".hulydesk-backup-");
            let mut backup = tempfile::Builder::new().prefix(&name).tempfile_in(parent)?;
            backup.write_all(existing.as_bytes())?;
            backup.as_file().sync_all()?;
            Some(backup.keep().map_err(|error| error.error)?.1)
        } else {
            None
        };
        new.persist(path).map_err(|error| error.error)?;
        Ok(backup_path)
    } else {
        new.persist_noclobber(path).map_err(|error| error.error)?;
        Ok(None)
    }
}

impl ClientFile {
    fn token_file(&self) -> Option<PathBuf> {
        matches!(self.format, Format::OpenCode)
            .then(|| self.path.with_file_name(OPENCODE_TOKEN_FILE))
    }

    fn status(&self, config: &McpConfig) -> ClientStatus {
        let inspect = || -> Result<Status, String> {
            let text = read_config(&self.path).map_err(|e| format!("读取配置失败：{e}"))?;
            let (state, _) = self.format.edit(text.as_deref(), config)?;
            if let Some(path) = self.token_file() {
                let token = read_config(&path).map_err(|e| format!("读取令牌文件失败：{e}"))?;
                if state == Status::Current
                    && token.as_deref().map(str::trim) != Some(&config.token)
                {
                    return Ok(Status::Stale);
                }
            }
            Ok(state)
        };
        let (state, note) = match inspect() {
            Ok(state) => (state, None),
            Err(error) => (Status::Invalid, Some(error)),
        };
        ClientStatus {
            state,
            path: self.path.display().to_string(),
            note,
        }
    }

    fn install(&self, config: &McpConfig) -> Result<String, String> {
        let previous = read_config(&self.path).map_err(|e| format!("读取配置失败：{e}"))?;
        let (status, updated) = self.format.edit(previous.as_deref(), config)?;
        if let Some(path) = self.token_file() {
            let token = read_config(&path).map_err(|e| format!("读取令牌文件失败：{e}"))?;
            if token.as_deref().map(str::trim) != Some(&config.token) {
                write_config(&path, token.as_deref(), &config.token, false)
                    .map_err(|e| format!("写入令牌文件失败：{e}"))?;
                if status == Status::Current {
                    return Ok("已更新 OpenCode 令牌。".into());
                }
            }
        }
        if status == Status::Current {
            return Ok("配置与当前服务一致，无须更新。".into());
        }
        match write_config(&self.path, previous.as_deref(), &updated, true)
            .map_err(|e| format!("写入配置失败：{e}"))?
        {
            Some(backup) => Ok(format!("已更新配置。备份：{}", backup.display())),
            None => Ok(format!("已创建配置：{}", self.path.display())),
        }
    }
}

#[tauri::command]
pub fn mcp_client_status(app: AppHandle, client: String) -> Result<ClientStatus, String> {
    let file = client_file(&app, &client)?;
    Ok(file.status(&mcp_get_config(app)?))
}

#[tauri::command]
pub fn mcp_add_to_client(app: AppHandle, client: String) -> Result<String, String> {
    let file = client_file(&app, &client)?;
    file.install(&mcp_get_config(app)?)
}

#[cfg(test)]
mod tests;
