use std::fs::{self, File};
use std::path::{Path, PathBuf};
use chrono::Local;
use quick_xml::de::from_str;
use quick_xml::se::to_string;

use tauri_plugin_log::log::{error, trace};

use crate::omnijot_file_cache::OmniJotFileCache;
use crate::omnijot_file_dir;
use crate::omnijot_file_struct::{OmniJotFileBody, OmniJotFileMeta};
use crate::omnijot_file_tar::{extract_meta, extract_to_cache, is_ojf_compressed, pack_cache};

// 文件名校验规则须与前端 NewFileDialog 保持一致，集中为常量避免两处漂移
const OJF_FORBIDDEN_CHARS: [char; 9] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
const OJF_RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];
const OJF_MAX_NAME_LEN: usize = 50;

#[tauri::command]
pub fn get_omnijot_file_meta(file_name: String) -> Result<OmniJotFileMeta, String> {
    trace!("尝试获取文件{}元信息", file_name);
    let path = omnijot_file_dir::get_omnijot_file_dir(resolve_ojf_file_name(&file_name)?);
    if !path.is_file() {
        error!("文件不存在或者是个目录: {:?}", path.to_str());
        return Err("文件不存在或者是个目录".to_string());
    }
    let compressed = is_ojf_compressed(&path).map_err(|e| e.to_string())?;
    let data = extract_meta(File::open(&path).map_err(|e| e.to_string())?, compressed)
        .map_err(|e| e.to_string())?;
    let xml = String::from_utf8(data).map_err(|e| e.to_string())?;
    match deserialize_omnijot_file_meta_xml(&xml) {
        Ok(meta) => Ok(meta),
        Err(e) => {
            error!("解码时出现错误:{}", e.to_string().as_str());
            Err("解码时出现错误".to_string())
        }
    }
}

#[tauri::command]
pub fn get_omnijot_file_body(file_name: String) -> Result<OmniJotFileBody, String> {
    trace!("尝试获取文件{}主体信息", file_name);
    let resolved_name = resolve_ojf_file_name(&file_name)?;
    let path = omnijot_file_dir::get_omnijot_file_dir(resolved_name.clone());
    if !path.is_file() {
        error!("文件不存在或者是个目录: {:?}", path.to_str());
        return Err("文件不存在或者是个目录".to_string());
    }
    let compressed = is_ojf_compressed(&path).map_err(|e| e.to_string())?;
    let mut cache = OmniJotFileCache::new_named(&resolved_name).map_err(|e| e.to_string())?;
    extract_to_cache(File::open(&path).map_err(|e| e.to_string())?, cache.path(), compressed).map_err(|e| e.to_string())?;
    // 调用方返回后仍会读取解包文件，此处不清理缓存目录
    cache.disable_cleanup();
    let result = deserialize_omnijot_file_body_xml(std::str::from_utf8(&cache.read_file("body.json").map_err(|e| e.to_string())?).map_err(|e| e.to_string())?);
    if let Ok(data) = result  {
        Ok(data)
    }
    else {
        let e = result.unwrap_err().to_string();
        error!("解码时出现错误:{}", e.as_str());
        Err("解码时出现错误".to_string())
    }
}

#[tauri::command]
pub fn set_omnijot_file_body(file_name: String, content: String) -> Result<(), String> {
    trace!("尝试保存文件{}主体信息", file_name);
    let resolved_name = resolve_ojf_file_name(&file_name)?;
    let path = omnijot_file_dir::get_omnijot_file_dir(resolved_name.clone());
    if !path.is_file() {
        error!("文件不存在或者是个目录: {:?}", path.to_str());
        return Err("文件不存在或者是个目录".to_string());
    }
    let compressed = is_ojf_compressed(&path).map_err(|e| e.to_string())?;
    let mut cache = OmniJotFileCache::new_named(&resolved_name).map_err(|e| e.to_string())?;
    // 目录缺 body.json 说明此前未走 get 解包，在此补一次
    if !cache.path().join("body.json").is_file() {
        extract_to_cache(File::open(&path).map_err(|e| e.to_string())?, cache.path(), compressed).map_err(|e| e.to_string())?;
    }
    cache.write_file("body.json", serialize_omnijot_file_body_xml(OmniJotFileBody { content }).map_err(|e| e.to_string()).map_err(|e| e.to_string())?.as_bytes()).map_err(|e| e.to_string())?;
    // body 已更新，需把缓存目录重新打包同步到 .ojf
    pack_cache_atomic(&path, cache.path(), compressed)?;
    cache.cleanup();
    Ok(())
}

#[tauri::command]
pub fn create_omnijot_file(
    omnijot_file_info: OmniJotFileMeta,
    file_name: String,
) -> Result<PathBuf, String> {
    trace!("尝试创建文件{}，元信息为{:?}", file_name, omnijot_file_info);
    let cache = OmniJotFileCache::new().map_err(|e| e.to_string())?;
    let meta_xml = serialize_omnijot_file_meta_xml(omnijot_file_info).map_err(|e| e.to_string())?;
    let body_xml = serialize_omnijot_file_body_xml(OmniJotFileBody {
        content: String::new(),
    })
    .map_err(|e| e.to_string())?;
    cache
        .write_file("meta.json", meta_xml.as_bytes())
        .map_err(|e| e.to_string())?;
    cache
        .write_file("body.json", body_xml.as_bytes())
        .map_err(|e| e.to_string())?;

    let file_path = omnijot_file_dir::get_omnijot_file_dir(resolve_ojf_file_name(&file_name)?);
    // 前端已拦截同名，后端仍须防覆盖既有笔记
    if file_path.exists() {
        return Err("同名文件已存在".to_string());
    }
    pack_cache_atomic(&file_path, cache.path(), true)?;
    Ok(file_path)
}

/// IPC 入口的 file_name 会拼进磁盘路径，按前端同名规则校验，防路径穿越与任意文件覆盖
fn resolve_ojf_file_name(file_name: &str) -> Result<String, String> {
    let resolved = if file_name.is_empty() {
        // 文件名可留空，留空时以时间戳生成默认名
        format!("我的笔记_{}", Local::now().format("%Y-%m-%d_%H-%M-%S"))
    } else {
        file_name.to_string()
    };
    if resolved.len() > OJF_MAX_NAME_LEN || resolved.starts_with(' ') || resolved.ends_with(&[' ', '.']) {
        return Err("文件名过长或首尾含非法字符".to_string());
    }
    if resolved.chars().any(|c| OJF_FORBIDDEN_CHARS.contains(&c)) {
        return Err("文件名不能包含 \\ / : * ? \" < > | 等字符".to_string());
    }
    if OJF_RESERVED_NAMES.contains(&resolved.to_ascii_uppercase().as_str()) {
        return Err("文件名不能是系统保留设备名".to_string());
    }
    Ok(resolved)
}

/// 直接截断原文件再打包，失败会损坏 .ojf；先写同目录临时文件再 rename，实现原子替换
fn pack_cache_atomic(path: &Path, root: &Path, compressed: bool) -> Result<(), String> {
    let tmp_path = path.with_extension("ojf.tmp");
    let packed = File::create(&tmp_path)
        .map_err(|e| e.to_string())
        .and_then(|writer| pack_cache(root, writer, compressed).map_err(|e| e.to_string()));
    if let Err(e) = packed {
        let _ = fs::remove_file(&tmp_path); // 忽略清理失败，不影响主流程
        return Err(e);
    }
    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path); // 忽略清理失败，不影响主流程
        e.to_string()
    })
}

fn deserialize_omnijot_file_meta_xml(xml: &str) -> Result<OmniJotFileMeta, quick_xml::DeError> {
    from_str(xml)
}

fn serialize_omnijot_file_meta_xml(omnijot_file: OmniJotFileMeta) -> Result<String, quick_xml::SeError> {
    to_string(&omnijot_file)
}

fn deserialize_omnijot_file_body_xml(xml: &str) -> Result<OmniJotFileBody, quick_xml::DeError> {
    from_str(xml)
}

fn serialize_omnijot_file_body_xml(omnijot_file: OmniJotFileBody) -> Result<String, quick_xml::SeError> {
    to_string(&omnijot_file)
}