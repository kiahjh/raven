use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize as PortablePtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

pub struct PtyInstance {
    pair: PtyPair,
    writer: Box<dyn Write + Send>,
}

pub struct PtyManager {
    instances: Mutex<HashMap<String, Arc<Mutex<PtyInstance>>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    data: String,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    id: String,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let manager = app.state::<PtyManager>();

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PortablePtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Get the user's default shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // Login shell

    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let instance = Arc::new(Mutex::new(PtyInstance { pair, writer }));

    {
        let mut instances = manager.instances.lock();
        instances.insert(id.clone(), instance);
    }

    // Spawn thread to read from PTY and emit events
    let app_clone = app.clone();
    let id_clone = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        &format!("pty-output-{}", id_clone),
                        PtyOutput {
                            id: id_clone.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    // Spawn thread to wait for child exit
    let app_clone = app.clone();
    let id_clone = id.clone();
    thread::spawn(move || {
        let _ = child.wait();
        let _ = app_clone.emit(&format!("pty-exit-{}", id_clone), id_clone);
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(app: AppHandle, id: String, data: String) -> Result<(), String> {
    let manager = app.state::<PtyManager>();
    let instances = manager.instances.lock();

    let instance = instances.get(&id).ok_or("PTY not found")?;
    let mut instance = instance.lock();

    instance
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn pty_resize(app: AppHandle, id: String, rows: u16, cols: u16) -> Result<(), String> {
    let manager = app.state::<PtyManager>();
    let instances = manager.instances.lock();

    let instance = instances.get(&id).ok_or("PTY not found")?;
    let instance = instance.lock();

    instance
        .pair
        .master
        .resize(PortablePtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn pty_kill(app: AppHandle, id: String) -> Result<(), String> {
    let manager = app.state::<PtyManager>();
    let mut instances = manager.instances.lock();

    instances.remove(&id);

    Ok(())
}
