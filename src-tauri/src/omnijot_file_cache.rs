// SPDX-License-Identifier: MIT

//! OmniJot 打包前的文件暂存缓存，路径跨平台自动生成：
//! - Windows：`%LOCALAPPDATA%\OmniJot\cache`
//! - macOS：`~/Library/Caches/OmniJot`
//! - Linux：`$XDG_CACHE_HOME/OmniJot`
//!
//! 缓存目录随结构体 Drop 自动清理，无需手动删除。
//! 典型流程：先 `write_file` 写入待打包内容，再把 `path()` 交给 `pack_cache` 打包。
//! 需要跨调用共享同一暂存区（如读写同一 `.ojf`）时，改用 `new_named(key)`。
//!
//! ```no_run
//! use std::fs::File;
//! use crate::omnijot_file_cache::OmniJotFileCache;
//! use crate::omnijot_file_tar::pack_cache;
//!
//! let cache = OmniJotFileCache::new()?;
//! cache.write_file("meta.json", b"<meta/>")?;
//! pack_cache(cache.path(), File::create("out.ojf")?, true)?;
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use platform_dirs::AppDirs;

pub struct OmniJotFileCache {
    root: PathBuf,
    cleanup_on_drop: bool,
}

impl OmniJotFileCache {
    pub fn new() -> io::Result<Self> {
        // 用进程号+纳秒时间戳生成唯一目录，避免并发冲突
        let unique_name = format!(
            "omnijot_{:x}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        Self::new_in(&unique_name)
    }

    /// 依据稳定 key 生成可复用的缓存目录，供读写共享同一暂存区
    pub fn new_named(key: &str) -> io::Result<Self> {
        let dir_name = format!(
            "omnijot_{:x}_{}",
            std::process::id(),
            sanitize_cache_key(key)
        );
        Self::new_in(&dir_name)
    }

    fn new_in(dir_name: &str) -> io::Result<Self> {
        let cache_base = AppDirs::new(Some("OmniJot"), false)
            .expect("无法解析系统缓存目录")
            .cache_dir;
        let root = cache_base.join(dir_name);
        fs::create_dir_all(&root)?;
        Ok(Self {
            root,
            cleanup_on_drop: true,
        })
    }

    pub fn path(&self) -> &Path {
        &self.root
    }

    /// 关闭 Drop 自动清理，保留目录供外部继续访问
    pub fn disable_cleanup(&mut self) {
        self.cleanup_on_drop = false;
    }

    /// 手动清理缓存目录，可对已 disable_cleanup 的实例主动调用以提前释放磁盘
    pub fn cleanup(&mut self) {
        self.cleanup_on_drop = false; // 目录已删除，阻止 Drop 重复清理
        remove_cache_dir(&self.root);
    }

    /// 以覆盖方式写入缓存内文件
    pub fn write_file(&self, name: &str, content: &[u8]) -> io::Result<()> {
        let mut file = File::create(self.root.join(name))?;
        file.write_all(content)
    }

    /// 读取缓存内文件内容
    pub fn read_file(&self, name: &str) -> io::Result<Vec<u8>> {
        fs::read(self.root.join(name))
    }
}

impl Drop for OmniJotFileCache {
    fn drop(&mut self) {
        if self.cleanup_on_drop {
            remove_cache_dir(&self.root);
        }
    }
}

/// 目录可能已被外部删除，清理失败需静默忽略
fn remove_cache_dir(root: &Path) {
    if root.exists() {
        let _ = fs::remove_dir_all(root);
    }
}

/// 进程异常退出或只读不存会残留孤儿缓存目录，启动早期清扫一次；此刻本进程尚未建目录，删除安全
pub fn cleanup_orphan_caches() {
    let Some(cache_base) = AppDirs::new(Some("OmniJot"), false).map(|dirs| dirs.cache_dir) else {
        return;
    };
    let Ok(entries) = fs::read_dir(cache_base) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_orphan = path.is_dir()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("omnijot_"));
        if is_orphan {
            let _ = fs::remove_dir_all(path); // 忽略清理失败，不影响启动
        }
    }
}

/// 缓存键会拼进目录路径，替换其中的文件系统非法字符与路径分隔符
fn sanitize_cache_key(key: &str) -> String {
    key.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect()
}
