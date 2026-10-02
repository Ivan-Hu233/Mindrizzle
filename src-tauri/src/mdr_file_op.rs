use std::fs::{self, File};
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};
use chrono::Local;
use quick_xml::de::from_str;
use quick_xml::se::to_string;
use anyhow::{Context, Result};
use log::{info, warn};
use tauri::{Emitter, Window};

use crate::mdr_file_cache::MindrizzleFileCache;
use crate::{mdr_file_dir, tauri_cmd};
use crate::mdr_file_struct::{MindrizzleFileBody, MindrizzleFileMeta, MindrizzleFileMetaView};
use crate::mdr_file_tar::{extract_meta, extract_to_cache, extract_to_cache_with_progress, is_mdrf_compressed, pack_cache};

// 文件名校验规则须与前端 NewFileDialog 保持一致，集中为常量避免两处漂移
const MINDRIZZLE_FILE_FORBIDDEN_CHARS: [char; 9] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
const MINDRIZZLE_FILE_RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];
const MINDRIZZLE_FILE_MAX_NAME_LEN: usize = 50;
const FILE_LOAD_PROGRESS_EVENT: &str = "file-load-progress";
const PROGRESS_VALIDATE: u32 = 2;
const PROGRESS_DETECT_FORMAT: u32 = 5;
const PROGRESS_CREATE_CACHE: u32 = 8;
const PROGRESS_EXTRACT_START: u32 = 12;
const PROGRESS_EXTRACT_RANGE: u32 = 58;
const PROGRESS_READ_BODY: u32 = 75;
const PROGRESS_PARSE_BODY: u32 = 85;
const PROGRESS_RETURN_BODY: u32 = 90;
const PROGRESS_COMPLETE: u32 = 100;
const DEBUG_PROGRESS_DELAY: Duration = Duration::from_millis(180);

tauri_cmd!{
    pub fn get_mdr_file_meta(file_name: String) -> anyhow::Result<MindrizzleFileMetaView> {
        let resolved_name = resolve_mdrf_file_name(&file_name).context("校验笔记文件名")?;
        let path = mdr_file_dir::get_mdr_file_dir(resolved_name.clone());
        if !path.is_file() {
            return Err(anyhow::anyhow!("文件不存在或者是个目录"));
        }
        let compressed = is_mdrf_compressed(&path).context("检测笔记压缩格式")?;
        let file = File::open(&path).with_context(|| format!("打开笔记文件：{}", resolved_name))?;
        let data = extract_meta(file, compressed).context("读取笔记元信息")?;
        let xml = String::from_utf8(data).context("转换笔记元信息编码")?;
        let meta = deserialize_mdr_file_meta_xml(&xml).context("解码笔记元信息")?;
        let updated_at = read_file_modified_millis(&path)?;
        Ok(MindrizzleFileMetaView { meta, updated_at })
    }

    pub fn set_mdr_file_body(file_name: String, content: String) -> anyhow::Result<()> {
        let resolved_name = resolve_mdrf_file_name(&file_name).context("校验笔记文件名")?;
        let path = mdr_file_dir::get_mdr_file_dir(resolved_name.clone());
        if !path.is_file() {
            return Err(anyhow::anyhow!("文件不存在或者是个目录"));
        }
        let compressed = is_mdrf_compressed(&path).context("检测笔记压缩格式")?;
        let mut cache = MindrizzleFileCache::new_named(&resolved_name)
            .with_context(|| format!("创建笔记缓存：{}", resolved_name))?;
        // 目录缺 body.json 说明此前未走 get 解包，所以在此补一次
        if !cache.path().join("body.json").is_file() {
            warn!("笔记缓存缺少正文，重新解包：{}", resolved_name);
            let file = File::open(&path).with_context(|| format!("打开笔记文件：{}", resolved_name))?;
            extract_to_cache(file, cache.path(), compressed).context("补充解包笔记正文")?;
        }
        let body_xml = serialize_mdr_file_body_xml(MindrizzleFileBody { content })
            .context("编码笔记正文")?;
        cache.write_file("body.json", body_xml.as_bytes()).context("写入笔记正文缓存")?;
        // body 已更新，所以重新打包同步到 .mdrf
        pack_cache_atomic(&path, cache.path(), compressed).context("保存笔记文件")?;
        cache.cleanup();
        info!("保存笔记正文成功：{}", resolved_name);
        Ok(())
    }
    
    pub fn create_mdr_file(
        mdr_file_info: MindrizzleFileMeta,
        file_name: String
    ) -> anyhow::Result<String> {
        let resolved_name = resolve_mdrf_file_name(&file_name).context("校验笔记文件名")?;
        let cache = MindrizzleFileCache::new().context("创建笔记缓存")?;
        let meta_xml = serialize_mdr_file_meta_xml(mdr_file_info)
            .context("编码笔记元信息")?;
        let body_xml = serialize_mdr_file_body_xml(MindrizzleFileBody {
            content: String::new(),
        })
        .context("编码初始笔记正文")?;
        cache.write_file("meta.json", meta_xml.as_bytes()).context("写入笔记元信息缓存")?;
        cache.write_file("body.json", body_xml.as_bytes()).context("写入初始笔记正文缓存")?;
    
        let file_path = mdr_file_dir::get_mdr_file_dir(resolved_name.clone());
        // 前端已拦截同名，后端仍须防覆盖既有笔记
        if file_path.exists() {
            return Err(anyhow::anyhow!("同名文件已存在"));
        }
        pack_cache_atomic(&file_path, cache.path(), true).context("写入笔记文件")?;
        info!("创建笔记成功：{}", resolved_name);
        Ok(resolved_name)
    }
}

#[tauri::command]
pub async fn get_mdr_file_body(
    window: Window,
    file_name: String,
    debug_progress: Option<bool>,
) -> Result<MindrizzleFileBody, tauri::ipc::InvokeError> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        read_mdr_file_body(&window, &file_name, debug_progress.unwrap_or(false))
    })
    .await
    .map_err(|error| {
        log::error!("IPC 命令 get_mdr_file_body 执行失败：读取任务异常：{}", error);
        tauri::ipc::InvokeError::from(format!("读取笔记任务异常：{error}"))
    })?;
    result.map_err(|error| {
        log::error!("IPC 命令 get_mdr_file_body 执行失败：{:#}", error);
        tauri::ipc::InvokeError::from(format!("{:#}", error))
    })
}

fn read_mdr_file_body(
    window: &Window,
    file_name: &str,
    is_debug_progress: bool,
) -> anyhow::Result<MindrizzleFileBody> {
    emit_file_load_progress(window, PROGRESS_VALIDATE, is_debug_progress);
    let resolved_name = resolve_mdrf_file_name(file_name).context("校验笔记文件名")?;
    let path = mdr_file_dir::get_mdr_file_dir(resolved_name.clone());
    if !path.is_file() {
        return Err(anyhow::anyhow!("文件不存在或者是个目录"));
    }
    let compressed = detect_file_compression(window, &path, is_debug_progress)?;
    let mut cache = create_file_cache(window, &resolved_name, is_debug_progress)?;
    let file = File::open(&path).with_context(|| format!("打开笔记文件：{}", resolved_name))?;
    emit_file_load_progress(window, PROGRESS_EXTRACT_START, is_debug_progress);
    extract_to_cache_with_progress(file, cache.path(), compressed, |value| {
        let progress = PROGRESS_EXTRACT_START + value * PROGRESS_EXTRACT_RANGE / PROGRESS_COMPLETE;
        emit_file_load_progress(window, progress, is_debug_progress);
    })
    .context("解包笔记正文")?;
    cache.disable_cleanup();
    let body = read_cached_mdr_file_body(window, &mut cache, is_debug_progress)?;
    info!("读取笔记正文成功：{}", resolved_name);
    Ok(body)
}

fn detect_file_compression(
    window: &Window,
    path: &Path,
    is_debug_progress: bool,
) -> anyhow::Result<bool> {
    emit_file_load_progress(window, PROGRESS_DETECT_FORMAT, is_debug_progress);
    is_mdrf_compressed(path).context("检测笔记压缩格式")
}

fn create_file_cache(
    window: &Window,
    file_name: &str,
    is_debug_progress: bool,
) -> anyhow::Result<MindrizzleFileCache> {
    emit_file_load_progress(window, PROGRESS_CREATE_CACHE, is_debug_progress);
    MindrizzleFileCache::new_named(file_name)
        .with_context(|| format!("创建笔记缓存：{}", file_name))
}

fn read_cached_mdr_file_body(
    window: &Window,
    cache: &mut MindrizzleFileCache,
    is_debug_progress: bool,
) -> anyhow::Result<MindrizzleFileBody> {
    emit_file_load_progress(window, PROGRESS_READ_BODY, is_debug_progress);
    let body_bytes = cache.read_file("body.json").context("读取笔记正文")?;
    emit_file_load_progress(window, PROGRESS_PARSE_BODY, is_debug_progress);
    let body_xml = std::str::from_utf8(&body_bytes).context("转换笔记正文编码")?;
    let body = deserialize_mdr_file_body_xml(body_xml).context("解码笔记正文")?;
    emit_file_load_progress(window, PROGRESS_RETURN_BODY, is_debug_progress);
    Ok(body)
}

fn emit_file_load_progress(window: &Window, progress: u32, is_debug_progress: bool) {
    let _ = window.emit(FILE_LOAD_PROGRESS_EVENT, progress);
    if is_debug_progress {
        std::thread::sleep(DEBUG_PROGRESS_DELAY);
    }
}

/// IPC 入口的 file_name 会拼进磁盘路径，按前端同名规则校验，防路径穿越与任意文件覆盖
fn resolve_mdrf_file_name(file_name: &str) -> anyhow::Result<String> {
    let resolved = if file_name.is_empty() {
        // 文件名可留空，留空时以时间戳生成默认名
        format!("我的笔记_{}", Local::now().format("%Y-%m-%d_%H-%M-%S"))
    } else {
        file_name.to_string()
    };
    if resolved.len() > MINDRIZZLE_FILE_MAX_NAME_LEN || resolved.starts_with(' ') || resolved.ends_with(&[' ', '.']) {
        return Err(anyhow::anyhow!("文件名过长或首尾含非法字符"));
    }
    if resolved.chars().any(|c| MINDRIZZLE_FILE_FORBIDDEN_CHARS.contains(&c)) {
        return Err(anyhow::anyhow!("文件名不能包含 \\ / : * ? \" < > | 等字符"));
    }
    if MINDRIZZLE_FILE_RESERVED_NAMES.contains(&resolved.to_ascii_uppercase().as_str()) {
        return Err(anyhow::anyhow!("文件名不能是系统保留设备名"));
    }
    Ok(resolved)
}

/// 保存正文时整包重写，故 .mdrf 的修改时间即上次编辑时间
fn read_file_modified_millis(path: &Path) -> anyhow::Result<i64> {
    let modified = fs::metadata(path)
        .with_context(|| format!("读取笔记文件属性：{}", path.display()))?
        .modified()
        .context("读取笔记文件修改时间")?;
    let elapsed = modified.duration_since(UNIX_EPOCH).context("笔记修改时间早于 UNIX 纪元")?;
    i64::try_from(elapsed.as_millis()).context("笔记修改时间超出可表示范围")
}

/// 直接截断原文件再打包失败会损坏 .mdrf，所以先写同目录临时文件再 rename 原子替换
fn pack_cache_atomic(path: &Path, root: &Path, compressed: bool) -> anyhow::Result<()> {
    let tmp_path = path.with_extension("mdrf.tmp");
    let packed = File::create(&tmp_path)
        
        .and_then(|writer| pack_cache(root, writer, compressed));
    if let Err(e) = packed {
        let _ = fs::remove_file(&tmp_path); // 忽略清理失败，不影响主流程
        return Err(e.into());
    }
    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path); // 忽略清理失败，不影响主流程
        e.into()
    })
}

fn deserialize_mdr_file_meta_xml(xml: &str) -> Result<MindrizzleFileMeta, quick_xml::DeError> {
    from_str(xml)
}

fn serialize_mdr_file_meta_xml(mdr_file: MindrizzleFileMeta) -> Result<String, quick_xml::SeError> {
    to_string(&mdr_file)
}

fn deserialize_mdr_file_body_xml(xml: &str) -> Result<MindrizzleFileBody, quick_xml::DeError> {
    from_str(xml)
}

fn serialize_mdr_file_body_xml(mdr_file: MindrizzleFileBody) -> Result<String, quick_xml::SeError> {
    to_string(&mdr_file)
}