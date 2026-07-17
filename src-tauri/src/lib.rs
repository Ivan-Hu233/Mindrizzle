mod hn_dir;
mod hn_op;
mod hn_struct;

use crate::hn_op::get_hypernote;

#[tauri::command]
fn fetch_file_list() -> Vec<String> {
    let mut file_list: Vec<String> = Vec::new();
    let dir = hn_dir::get_hn_dir();
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_file() {
            if let Some(file_name) = path.file_stem() {
                if let Some(file_name_str) = file_name.to_str() {
                    file_list.push(file_name_str.to_string());
                }
            }
        }
    }
    file_list
}

use tokio::fs;

#[tauri::command]
async fn is_file_name_valid(file_name: String) -> bool {
    let path = hn_dir::get_hn_dir().join(file_name + ".hn");
    !fs::try_exists(path).await.unwrap_or(false)
}

#[tauri::command]
fn get_file_info(file_name: &str) -> Result<hn_struct::HyperNote, &str> {
    if let Ok(hypernote) = get_hypernote(file_name) {
        Ok(hypernote)
    } else {
        Err("便签怎么皱成一团了！")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![fetch_file_list, get_file_info, is_file_name_valid])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
