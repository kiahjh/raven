mod daemon;
mod pty;

use daemon::{
    daemon_attach, daemon_detach, daemon_kill, daemon_list, daemon_resize, daemon_spawn,
    daemon_write, DaemonManager,
};
use pty::{pty_kill, pty_resize, pty_spawn, pty_write, PtyManager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(PtyManager::new())
        .manage(DaemonManager::new())
        .invoke_handler(tauri::generate_handler![
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
