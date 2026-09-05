mod omnijot_file_cache;
mod omnijot_file_dir;
mod omnijot_file_op;
mod omnijot_file_struct;
mod omnijot_file_tar;

use tauri_plugin_log::{
    RotationStrategy, Target, TargetKind, TimezoneStrategy, fern::FormatCallback, log::{LevelFilter, trace},
};
use log::Record;
use std::fmt::Arguments;
use tokio::fs;

#[tauri::command]
fn fetch_file_list() -> Vec<String> {
    let mut file_list: Vec<String> = Vec::new();
    let dir = omnijot_file_dir::get_omnijot_file_save_dir();
    trace!("正在扫描路径：{:?}", dir.to_str());
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_file() {
            let is_omnijot_file = path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("ojf"));

            if !is_omnijot_file {
                trace!("跳过非 .ojf 文件：{:?}", path.to_str());
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
    let path = omnijot_file_dir::get_omnijot_file_dir(file_name);
    let result = !fs::try_exists(path).await.unwrap_or(false);
    trace!("检查文件名是否占用结果：{}", !result);
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 清扫历史退出残留的孤儿缓存目录；启动早期本进程尚未创建缓存，删除安全
    omnijot_file_cache::cleanup_orphan_caches();

    let log_level = if tauri::is_dev() {
        LevelFilter::Trace
    } else {
        LevelFilter::Info
    };
    let custom_format = |out: FormatCallback<'_>, args: &Arguments<'_>, record: &Record<'_>|{
        out.finish(format_args!(
            "[{}] [{}@{}:{}] [{}] {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            record.target(),
            record.file().unwrap_or("?"),
            record.line().unwrap_or(0),
            record.level(),
            args.to_string().rsplit_once("] ").unwrap().1//FIXME: Tauri日志插件不符合预期，会输出默认日志格式，使格式重复
        ))
    };
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log_level)
                .targets([
                    Target::new(TargetKind::Stdout).format(custom_format),//FIXME: Tauri日志插件不符合预期，必须手动在target内设置格式
                    Target::new(TargetKind::Webview).format(custom_format),
                    Target::new(TargetKind::LogDir { file_name: None }).format(custom_format),
                ])
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .max_file_size(1_000_000)
                .rotation_strategy(RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fetch_file_list,
            is_file_name_valid,
            omnijot_file_op::get_omnijot_file_meta,
            omnijot_file_op::get_omnijot_file_body,
            omnijot_file_op::set_omnijot_file_body,
            omnijot_file_op::create_omnijot_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
