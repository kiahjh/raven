use ignore::WalkBuilder;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

/// List all files in a directory, respecting .gitignore.
/// Returns paths relative to the given root directory.
#[tauri::command]
pub fn list_files(root: String) -> Result<Vec<String>, String> {
    let root_path = Path::new(&root);
    if !root_path.exists() {
        return Err(format!("Directory does not exist: {}", root));
    }

    let mut files = Vec::new();

    for entry in WalkBuilder::new(&root)
        .hidden(true) // skip hidden files
        .git_ignore(true) // respect .gitignore
        .git_global(true)
        .git_exclude(true)
        .build()
    {
        let entry = entry.map_err(|e| format!("Walk error: {}", e))?;
        let path = entry.path();

        // Skip directories, only include files
        if path.is_file() {
            // Get path relative to root
            if let Ok(relative) = path.strip_prefix(&root) {
                if let Some(s) = relative.to_str() {
                    files.push(s.to_string());
                }
            }
        }
    }

    // Sort alphabetically for consistent ordering
    files.sort();

    Ok(files)
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }

    fs::write(&path, content).map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}
