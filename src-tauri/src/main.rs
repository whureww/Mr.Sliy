#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod sidecar;

use sidecar::SidecarState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

/// 显示并聚焦主窗口（单实例回调 / 托盘双入口共用）
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        // 单实例：必须最先注册。二次启动时聚焦已有窗口而非拉起新进程
        // （否则会 spawn 多个 sidecar，端口/数据库互相冲突）
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 先占位 port=0（前端轮询直到非 0）,再由后台线程拉起 sidecar 并等待健康检查。
            // 必须异步:同步 wait_for_health 会阻塞 Tauri 主线程消息泵 1~3s,
            // WebView2 首帧无法呈现 → 启动白屏、splash 动画被吃掉。
            app.manage(SidecarState { port: std::sync::atomic::AtomicU16::new(0) });
            {
                let handle_sidecar = app.handle().clone();
                std::thread::spawn(move || match sidecar::spawn_sidecar(&handle_sidecar) {
                    Ok(port) => {
                        match sidecar::wait_until_healthy(port, std::time::Duration::from_secs(25)) {
                            Ok(()) => {
                                if let Some(st) = handle_sidecar.try_state::<SidecarState>() {
                                    st.port.store(port, std::sync::atomic::Ordering::Relaxed);
                                }
                                eprintln!("[sidecar] ready on 127.0.0.1:{port}");
                            }
                            Err(e) => eprintln!("[sidecar] health check failed: {e}"),
                        }
                    }
                    Err(e) => eprintln!("[sidecar] spawn failed: {e}"),
                });
            }

            // 系统托盘：最小化到托盘后程序仍后台运行，从托盘可随时唤回
            let show_item = MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray-quit", "退出 MR·SLIY", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // 兜底显示窗口：若前端异常(脚本错误/资源加载失败)导致窗口未显示,
            // 8s 后在此强制显示,宁可让用户看到空白页也不能看起来"双击没反应"
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(8));
                show_main_window(&handle);
            });

            // 白屏规避:AMD 等部分显卡驱动 + WebView2 会偶发"首帧不呈现"——页面早已加载完,
            // 但合成器不刷新,窗口持续白屏,任何窗口尺寸变化都会立即恢复。
            // 启动后前 2.7 秒做几次 1px 尺寸抖动强制合成器出帧(视觉无感),
            // 该时段恰为启动动画展示期,必须保证可见。
            let handle_nudge = app.handle().clone();
            std::thread::spawn(move || {
                for interval_ms in [250u64, 800, 800, 800] {
                    std::thread::sleep(std::time::Duration::from_millis(interval_ms));
                    if let Some(w) = handle_nudge.get_webview_window("main") {
                        if let Ok(sz) = w.inner_size() {
                            let bumped = tauri::PhysicalSize::new(sz.width + 1, sz.height + 1);
                            let _ = w.set_size(bumped);
                            std::thread::sleep(std::time::Duration::from_millis(60));
                            let _ = w.set_size(sz);
                        }
                    }
                }
            });

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().expect("no window icon").clone())
                .tooltip("MR·SLIY 代码优化智能体 · 后台运行中")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray-show" => show_main_window(app),
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // 左键单击托盘图标：唤回主窗口
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // 拦截关闭请求：转发给前端弹"最小化到托盘 / 退出"对话框，
            // 覆盖自绘关闭按钮、Alt+F4、任务栏右键关闭三条路径
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_health,
            commands::sidecar_port,
            commands::list_dir,
            commands::read_file,
            commands::save_file,
            commands::state_file_path,
            commands::analyze_file,
            commands::optimize_issue,
            commands::issue_stats,
            commands::minimize_to_tray,
            commands::exit_app,
            commands::install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
