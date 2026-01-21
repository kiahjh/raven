mod daemon;
mod pty;

use daemon::{
    daemon_attach, daemon_detach, daemon_kill, daemon_list, daemon_resize, daemon_spawn,
    daemon_write, DaemonManager,
};
use pty::{pty_kill, pty_resize, pty_spawn, pty_write, PtyManager};
use tauri::WebviewWindow;

// Window control commands
#[tauri::command]
fn window_close(window: WebviewWindow) {
    window.close().unwrap();
}

#[tauri::command]
fn window_minimize(window: WebviewWindow) {
    window.minimize().unwrap();
}

#[tauri::command]
fn window_maximize(window: WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().unwrap();
    } else {
        window.maximize().unwrap();
    }
}

#[tauri::command]
fn window_fullscreen(window: WebviewWindow) {
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    window.set_fullscreen(!is_fullscreen).unwrap();
}

#[tauri::command]
fn window_start_drag(window: WebviewWindow) {
    window.start_dragging().unwrap();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(PtyManager::new())
        .manage(DaemonManager::new())
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            // Window controls
            window_close,
            window_minimize,
            window_maximize,
            window_fullscreen,
            window_start_drag,
            // Legacy PTY commands (will be deprecated)
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            // Daemon commands (persistent terminals)
            daemon_spawn,
            daemon_write,
            daemon_resize,
            daemon_detach,
            daemon_kill,
            daemon_list,
            daemon_attach
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
