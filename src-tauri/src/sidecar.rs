//! Node sidecar 进程管理：spawn 现有 Express server 并等待健康检查通过。

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU16, Ordering};
use std::time::{Duration, Instant};
use tauri::Manager;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// sidecar 端口共享状态：0 = 尚未就绪（前端轮询 sidecar_port 直到非 0）
pub struct SidecarState {
    pub port: AtomicU16,
}

impl SidecarState {
    pub fn port(&self) -> u16 {
        self.port.load(Ordering::Relaxed)
    }
}

/// 启动 sidecar（dev: 系统 node + 项目根 sidecar.js；release: 资源目录）
/// 只负责拉起进程并立即返回端口;健康检查由调用方后台线程执行,
/// 严禁在 Tauri 主线程同步等待——会冻结消息泵,WebView2 首帧无法呈现(白屏)。
pub fn spawn_sidecar(app: &tauri::AppHandle) -> Result<u16, String> {
    let port = pick_free_port().ok_or("no free port available")?;
    let script = resolve_script(app)?;
    let node_bin = resolve_node();

    // cwd 设为可写数据目录：Node 侧相对路径写操作（如 logs/）落在 ~/.mr-sliy，
    // 避免安装到 Program Files 后 EPERM；require 解析不受 cwd 影响
    let data_dir = std::env::var("USERPROFILE")
        .map(PathBuf::from)
        .map_err(|_| "no USERPROFILE")?
        .join(".mr-sliy");
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir failed: {e}"))?;

    Command::new(&node_bin)
        .arg(&script)
        .env("MRSLIY_PORT", port.to_string())
        .env("MRSLIY_MODE", "desktop")
        .env("MRSLIY_PARENT_PID", std::process::id().to_string())
        .current_dir(data_dir)
        .creation_flags(CREATE_NO_WINDOW) // node.exe 是控制台程序，抑制其弹出 DOS 窗口
        .spawn()
        .map_err(|e| format!("spawn node failed: {e}"))?;

    Ok(port)
}

/// 阻塞等待 sidecar 健康检查通过（仅供后台线程调用）
pub fn wait_until_healthy(port: u16, timeout: Duration) -> Result<(), String> {
    wait_for_health(port, timeout)
}

fn resolve_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        // dev：cargo run 的 cwd 是 src-tauri，sidecar.js 在项目根
        let mut p = std::env::current_dir().map_err(|e| e.to_string())?;
        if p.file_name().map_or(false, |n| n == "src-tauri") {
            p = p.parent().expect("parent").to_path_buf();
        }
        Ok(p.join("sidecar.js"))
    } else {
        // release：sidecar.js 与 src/ 一并打进资源目录（tauri.conf.json bundle resources 配置）
        app.path()
            .resolve("sidecar.js", tauri::path::BaseDirectory::Resource)
            .map_err(|e| e.to_string())
    }
}

fn resolve_node() -> PathBuf {
    // 1. 安装版：exe 同目录 runtime\node.exe（由 Inno Setup 安装包提供）
    if let Ok(exe) = std::env::current_exe() {
        let bundled = exe
            .parent()
            .expect("exe dir")
            .join("runtime")
            .join("node.exe");
        if bundled.exists() {
            return bundled;
        }
    }
    // 2. dev：系统 PATH 中的 node
    PathBuf::from("node")
}

fn pick_free_port() -> Option<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").ok()?;
    listener.local_addr().ok().map(|a| a.port())
}

/// 手写 HTTP GET /health，避免在启动关键路径引入异步运行时
fn wait_for_health(port: u16, timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    let req = format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");

    while start.elapsed() < timeout {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
            if stream.write_all(req.as_bytes()).is_ok() {
                let mut buf = Vec::new();
                let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                if stream.read_to_end(&mut buf).is_ok() {
                    let head = String::from_utf8_lossy(&buf);
                    if head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200") {
                        return Ok(());
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    Err(format!("sidecar health check timeout after {}s", timeout.as_secs()))
}
