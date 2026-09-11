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
            match sidecar::spawn_sidecar(app.handle()) {
                Ok(port) => {
                    eprintln!("[sidecar] ready on 127.0.0.1:{port}");
                    app.manage(SidecarState { port });
                }
                Err(e) => {
                    eprintln!("[sidecar] spawn failed: {e}");
                    // 端口置 0：窗口仍可启动，前端显示"服务未就绪"
                    app.manage(SidecarState { port: 0 });
                }
            }

            // 系统托盘：最小化到托盘后程序仍后台运行，从托盘可随时唤回
            let show_item = MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray-quit", "退出 MR·SLIY", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

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
