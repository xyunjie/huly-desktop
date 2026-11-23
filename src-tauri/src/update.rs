use reqwest::StatusCode;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::utils::{config::BundleType, platform::bundle_type};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

const LATEST_RELEASE: &str = "https://api.github.com/repos/xyunjie/huly-desktop/releases/latest";
const RELEASE_DOWNLOADS: &str = "https://github.com/xyunjie/huly-desktop/releases/download";
static UPDATE_INSTALL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<ReleaseAsset>,
}

#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    current_version: String,
    latest_version: Option<String>,
    update_available: bool,
    install_unavailable: Option<&'static str>,
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateProgress {
    Downloading { downloaded: u64, total: Option<u64> },
    Installing,
}

fn stable_version(value: &str) -> Result<Version, String> {
    Version::parse(value)
        .ok()
        .filter(|version| version.pre.is_empty() && version.build.is_empty())
        .ok_or_else(|| "GitHub 发布版本号格式不正确。".into())
}

fn compare_release(
    current: &Version,
    release: Option<GitHubRelease>,
) -> Result<UpdateCheck, String> {
    let release = release.filter(|release| !release.draft && !release.prerelease);
    let latest = release
        .as_ref()
        .map(|release| {
            let version = release
                .tag_name
                .strip_prefix('v')
                .ok_or("GitHub 发布版本号格式不正确。")?;
            stable_version(version)
        })
        .transpose()?;
    let update_available = latest
        .as_ref()
        .is_some_and(|latest| latest.cmp_precedence(current).is_gt());
    let install_unavailable = release
        .as_ref()
        .filter(|_| update_available)
        .filter(|release| {
            !release
                .assets
                .iter()
                .any(|asset| asset.name == "latest.json" && asset.state == "uploaded")
        })
        .map(|_| "这个版本没有发布签名更新包，暂不能在应用内安装。");
    Ok(UpdateCheck {
        current_version: current.to_string(),
        latest_version: latest.as_ref().map(ToString::to_string),
        update_available,
        install_unavailable,
    })
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateCheck, String> {
    let response = reqwest::Client::builder()
        .user_agent("Huly Desk Update Checker")
        .timeout(Duration::from_secs(10))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法创建 GitHub 更新请求。")?
        .get(LATEST_RELEASE)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "无法连接 GitHub，请检查网络后重试。")?;
    let release = match response.status() {
        StatusCode::OK => Some(
            response
                .json()
                .await
                .map_err(|_| "无法读取 GitHub 发布信息。")?,
        ),
        StatusCode::NOT_FOUND => None,
        StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
            return Err("GitHub 暂时限制更新查询，请稍后重试。".into());
        }
        status => return Err(format!("检查更新失败（GitHub HTTP {}）。", status.as_u16())),
    };
    let mut checked = compare_release(&app.package_info().version, release)?;
    if checked.update_available {
        checked.install_unavailable = install_blocker(&app).or(checked.install_unavailable);
    }
    Ok(checked)
}

fn install_blocker(app: &AppHandle) -> Option<&'static str> {
    if cfg!(debug_assertions)
        || !matches!(
            bundle_type(),
            Some(BundleType::App | BundleType::Nsis | BundleType::Deb | BundleType::AppImage)
        )
    {
        return Some("当前运行的不是受支持的正式安装包，不能在应用内安装更新。");
    }
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(serde_json::Value::as_str);
    if key.is_none_or(|key| key.trim().is_empty()) {
        return Some("当前安装包未配置更新签名，不能在应用内安装更新。");
    }
    None
}

fn download_prefix(version: &Version) -> String {
    format!("{RELEASE_DOWNLOADS}/v{version}/")
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    version: String,
    on_progress: Channel<UpdateProgress>,
) -> Result<(), String> {
    let _installing = UPDATE_INSTALL
        .try_lock()
        .map_err(|_| "已有更新任务正在运行。")?;
    if let Some(reason) = install_blocker(&app) {
        return Err(reason.into());
    }
    let version = stable_version(&version)?;
    if !version.cmp_precedence(&app.package_info().version).is_gt() {
        return Err("更新版本必须比当前版本新。".into());
    }
    let prefix = download_prefix(&version);
    let endpoint = format!("{prefix}latest.json")
        .parse()
        .map_err(|_| "更新清单地址无效。")?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .and_then(|builder| builder.timeout(Duration::from_secs(15 * 60)).build())
        .map_err(|_| "无法启动应用内更新。")?;
    let update = tokio::time::timeout(Duration::from_secs(20), updater.check())
        .await
        .map_err(|_| "读取更新清单超时，请重试。")?
        .map_err(|error| format!("无法读取本机对应的更新包：{error}"))?
        .ok_or("没有可安装的新版，请重新检查。")?;
    if update.version != version.to_string() || !update.download_url.as_str().starts_with(&prefix) {
        return Err("更新清单与检测到的 GitHub 版本不一致，已取消安装。".into());
    }

    let mut downloaded = 0u64;
    let mut reported = 0u64;
    // The Tauri updater verifies both the artifact and its signed version before installation.
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if reported == 0 || downloaded - reported >= 256 * 1024 || total == Some(downloaded)
                {
                    reported = downloaded;
                    let _ = on_progress.send(UpdateProgress::Downloading { downloaded, total });
                }
            },
            || {},
        )
        .await
        .map_err(|error| format!("下载或签名验证失败，未安装更新：{error}"))?;
    let _ = on_progress.send(UpdateProgress::Installing);
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|_| "更新安装未完成。")?
        .map_err(|error| format!("无法安装更新：{error}"))?;
    // Windows hands restart to the NSIS installer. Other platforms relaunch here.
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag.into(),
            draft: false,
            prerelease: false,
            assets: vec![ReleaseAsset {
                name: "latest.json".into(),
                state: "uploaded".into(),
            }],
        }
    }

    #[test]
    fn compares_versions_numerically_without_offering_downgrades() {
        let current = Version::new(1, 9, 0);
        let newer = compare_release(&current, Some(release("v1.10.0"))).unwrap();
        assert_eq!(newer.current_version, "1.9.0");
        assert_eq!(newer.latest_version.as_deref(), Some("1.10.0"));
        assert!(newer.update_available);
        assert!(newer.install_unavailable.is_none());
        for tag in ["v1.9.0", "v1.8.0"] {
            assert!(
                !compare_release(&current, Some(release(tag)))
                    .unwrap()
                    .update_available
            );
        }
    }

    #[test]
    fn skips_unpublished_releases_and_rejects_invalid_tags() {
        let current = Version::new(1, 0, 0);
        assert!(compare_release(&current, None)
            .unwrap()
            .latest_version
            .is_none());
        let mut beta = release("v2.0.0-beta.1");
        beta.prerelease = true;
        assert!(compare_release(&current, Some(beta))
            .unwrap()
            .latest_version
            .is_none());
        for tag in ["release-2", "v2.0.0-beta.1", "v2.0.0/other", "v2.00.0"] {
            assert!(compare_release(&current, Some(release(tag))).is_err());
        }
    }

    #[test]
    fn an_unsigned_release_can_be_detected_but_not_installed() {
        let mut latest = release("v1.1.0");
        latest.assets.clear();
        let checked = compare_release(&Version::new(1, 0, 0), Some(latest)).unwrap();
        assert!(checked.update_available && checked.install_unavailable.is_some());
    }
}
