//! Tauri IPC 命令：原生文件操作 + 转发到 Node sidecar 的 REST API。

use crate::sidecar::SidecarState;
use serde::Serialize;
use serde_json::json;
use std::fs;
use std::time::Duration;
use tauri::{Manager, State};

fn base(port: u16) -> Result<String, String> {
    if port == 0 {
        return Err("sidecar 未就绪，请重启应用".into());
    }
    Ok(format!("http://127.0.0.1:{port}"))
}

fn get_json(port: u16, path: &str) -> Result<serde_json::Value, String> {
    let url = format!("{}{path}", base(port)?);
    reqwest::blocking::get(&url)
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

fn post_json(port: u16, path: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let url = format!("{}{path}", base(port)?);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

// ---------- 服务健康 ----------

#[tauri::command]
pub fn sidecar_health(state: State<SidecarState>) -> Result<serde_json::Value, String> {
    get_json(state.port, "/health")
}

#[tauri::command]
pub fn sidecar_port(state: State<SidecarState>) -> u16 {
    state.port
}

// ---------- 窗口生命周期（关闭确认对话框选项） ----------

/// 最小化到托盘：隐藏窗口，sidecar 继续后台运行
#[tauri::command]
pub fn minimize_to_tray(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

/// 退出程序：sidecar 由父进程 watchdog（MRSLIY_PARENT_PID）自动跟随退出
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ---------- 原生文件操作 ----------

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<FileNode>, String> {
    eprintln!("[list_dir] invoke path={path}");
    let mut nodes = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map_err(|e| e.to_string())?.is_dir();
        nodes.push(FileNode {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
        });
    }
    // 目录在前，各自按名称排序
    nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    eprintln!("[list_dir] ok {} entries", nodes.len());
    Ok(nodes)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(json!({
        "content": content,
        "language": detect_language(&path)
    }))
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 前端状态文件路径：~/.mr-sliy/gui-state/<name>.json
/// localStorage 在 WebView2 中异步落盘，进程被强杀（看门狗/崩溃）时会丢数据，
/// 工作区与会话状态改用文件持久化。
#[tauri::command]
pub fn state_file_path(name: String) -> Result<String, String> {
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid state name".into());
    }
    let home = std::env::var("USERPROFILE").map_err(|_| "no USERPROFILE".to_string())?;
    let dir = std::path::Path::new(&home).join(".mr-sliy").join("gui-state");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")).to_string_lossy().to_string())
}

fn detect_language(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "js" | "mjs" | "cjs" => "javascript",
        "ts" | "tsx" => "typescript",
        "py" => "python",
        "java" => "java",
        "go" => "go",
        "rs" => "rust",
        "json" => "json",
        _ => "plaintext",
    }
}

// ---------- 转发到 sidecar 的业务 API ----------

#[tauri::command]
pub fn analyze_file(
    state: State<SidecarState>,
    filePath: String,
    sourceCode: String,
) -> Result<serde_json::Value, String> {
    post_json(
        state.port,
        "/api/scan/file",
        json!({ "filePath": filePath, "sourceCode": sourceCode }),
    )
}

#[tauri::command]
pub fn optimize_issue(
    state: State<SidecarState>,
    code: String,
    filePath: Option<String>,
    language: Option<String>,
    issueType: Option<String>,
    message: Option<String>,
) -> Result<serde_json::Value, String> {
    post_json(
        state.port,
        "/api/ai/optimize",
        json!({
            "code": code,
            "filePath": filePath,
            "language": language,
            "issueType": issueType,
            "message": message
        }),
    )
}

#[tauri::command]
pub fn issue_stats(state: State<SidecarState>) -> Result<serde_json::Value, String> {
    get_json(state.port, "/api/issues/stats")
}
