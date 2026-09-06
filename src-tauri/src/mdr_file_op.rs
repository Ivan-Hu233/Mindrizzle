use std::fs::{self, File};
use std::path::Path;
use chrono::Local;
use quick_xml::de::from_str;
use quick_xml::se::to_string;
use anyhow::{Context, Result};
use log::{info, warn};

use crate::mdr_file_cache::MindrizzleFileCache;
use crate::{mdr_file_dir, tauri_cmd};
use crate::mdr_file_struct::{MindrizzleFileBody, MindrizzleFileMeta};
use crate::mdr_file_tar::{extract_meta, extract_to_cache, is_mdrf_compressed, pack_cache};

// 文件名校验规则须与前端 NewFileDialog 保持一致，集中为常量避免两处漂移
const MINDRIZZLE_FILE_FORBIDDEN_CHARS: [char; 9] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
const MINDRIZZLE_FILE_RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];
const MINDRIZZLE_FILE_MAX_NAME_LEN: usize = 50;

tauri_cmd!{
    pub fn get_mdr_file_meta(file_name: String) -> anyhow::Result<MindrizzleFileMeta> {
        let resolved_name = resolve_mdrf_file_name(&file_name).context("校验笔记文件名")?;
        let path = mdr_file_dir::get_mdr_file_dir(resolved_name.clone());
        if !path.is_file() {
            return Err(anyhow::anyhow!("文件不存在或者是个目录"));
        }
        let compressed = is_mdrf_compressed(&path).context("检测笔记压缩格式")?;
        let file = File::open(&path).with_context(|| format!("打开笔记文件：{}", resolved_name))?;
        let data = extract_meta(file, compressed).context("读取笔记元信息")?;
        let xml = String::from_utf8(data).context("转换笔记元信息编码")?;
        deserialize_mdr_file_meta_xml(&xml).context("解码笔记元信息")
    }

    pub fn get_mdr_file_body(file_name: String) -> anyhow::Result<MindrizzleFileBody> {
        let resolved_name = resolve_mdrf_file_name(&file_name).context("校验笔记文件名")?;
        let path = mdr_file_dir::get_mdr_file_dir(resolved_name.clone());
        if !path.is_file() {
            return Err(anyhow::anyhow!("文件不存在或者是个目录"));
        }
        let compressed = is_mdrf_compressed(&path).context("检测笔记压缩格式")?;
        let mut cache = MindrizzleFileCache::new_named(&resolved_name)
            .with_context(|| format!("创建笔记缓存：{}", resolved_name))?;
        let file = File::open(&path).with_context(|| format!("打开笔记文件：{}", resolved_name))?;
        extract_to_cache(file, cache.path(), compressed).context("解包笔记正文")?;
        // 调用方返回后仍会读取解包文件，此处不清理缓存目录
        cache.disable_cleanup();
        let body_bytes = cache.read_file("body.json").context("读取笔记正文")?;
        let body_xml = std::str::from_utf8(&body_bytes).context("转换笔记正文编码")?;
        let body = deserialize_mdr_file_body_xml(body_xml).context("解码笔记正文")?;
        info!("读取笔记正文成功：{}", resolved_name);
        Ok(body)
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
        // 目录缺 body.json 说明此前未走 get 解包，在此补一次
        if !cache.path().join("body.json").is_file() {
            warn!("笔记缓存缺少正文，重新解包：{}", resolved_name);
            let file = File::open(&path).with_context(|| format!("打开笔记文件：{}", resolved_name))?;
            extract_to_cache(file, cache.path(), compressed).context("补充解包笔记正文")?;
        }
        let body_xml = serialize_mdr_file_body_xml(MindrizzleFileBody { content })
            .context("编码笔记正文")?;
        cache.write_file("body.json", body_xml.as_bytes()).context("写入笔记正文缓存")?;
        // body 已更新，需把缓存目录重新打包同步到 .mdrf
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

/// 直接截断原文件再打包，失败会损坏 .mdrf；先写同目录临时文件再 rename，实现原子替换
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