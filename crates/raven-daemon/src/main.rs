mod protocol;
mod server;
mod session;

use directories::ProjectDirs;
use std::path::PathBuf;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

fn get_socket_path() -> PathBuf {
    // Allow overriding socket path via environment (for testing)
    if let Ok(path) = std::env::var("RAVEN_SOCKET_PATH") {
        return PathBuf::from(path);
    }
    
    if let Some(proj_dirs) = ProjectDirs::from("com", "innocencelabs", "raven") {
        let runtime_dir = proj_dirs.runtime_dir().unwrap_or(proj_dirs.data_dir());
        std::fs::create_dir_all(runtime_dir).ok();
        runtime_dir.join("daemon.sock")
    } else {
        PathBuf::from("/tmp/raven-daemon.sock")
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Set up logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    let socket_path = get_socket_path();
    info!("Starting raven-daemon at {:?}", socket_path);

    // Clean up old socket if it exists
    if socket_path.exists() {
        std::fs::remove_file(&socket_path)?;
    }

    server::run(socket_path).await
}
