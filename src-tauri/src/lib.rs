mod hn_fs;
mod hn_op;
mod hn_struct;

use std::result;

use crate::hn_op::get_hypernote;

use tauri_plugin_log::{
    log::{error, trace, LevelFilter},
    RotationStrategy, Target, TargetKind,
};
use tokio::fs;

#[tauri::command]
fn fetch_file_list() -> Vec<String> {
    let mut file_list: Vec<String> = Vec::new();
    let dir = hn_fs::get_hn_save_dir();
    trace!("正在扫描路径：{:?}", dir.to_str());
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_file() {
            let is_hn_file = path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("hn"));

            if !is_hn_file {
                trace!("跳过非 .hn 文件：{:?}", path.to_str());
                continue;
            }

            trace!("找到文件：{:?}", path.to_str());
            if let Some(file_name) = path.file_stem() {
                if let Some(file_name_str) = file_name.to_str() {
                    file_list.push(file_name_str.to_string());
                }
            }
        }
    }
    file_list
}

#[tauri::command]
async fn is_file_name_valid(file_name: String) -> bool {
    let path = hn_fs::get_hn_file_dir(file_name);
    let result = !fs::try_exists(path).await.unwrap_or(false);
    trace!("检查文件名是否占用结果：{}", !result);
    result
}

#[tauri::command]
fn get_file_info(file_name: &str) -> Result<hn_struct::HyperNote, &str> {
    trace!("尝试获取文件{}信息", file_name);
    let tmp_hn = get_hypernote(file_name.to_string());
    let Ok(hypernote) = tmp_hn else {
        let e = tmp_hn.unwrap_err().to_string();
        error!("{}", e.as_str());
        return Err("便签怎么皱成一团了！");
    };
    Ok(hypernote)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_level = if tauri::is_dev() {
        LevelFilter::Trace // 开发时输出所有日志
    } else {
        LevelFilter::Info // 发布后只输出 info 及以上
    };
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log_level)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::Webview),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .max_file_size(1_000_000)
                .rotation_strategy(RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fetch_file_list,
            get_file_info,
            is_file_name_valid,
            hn_op::create_hypernote
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
