// SPDX-License-Identifier: MIT

//! OmniJot `.ojf` 文件的打包与解包。
//!
//! - [`pack_cache`]：把缓存目录打包为 tar（可 gzip 压缩），生成 `.ojf` 文件。
//! - [`extract_to_cache`]：把 `.ojf` 文件解包回缓存目录，供后续读取。
//! - [`is_ojf_compressed`]：依据文件头魔数判断 `.ojf` 是否 gzip 压缩。
//!
//! ```no_run
//! use std::fs::File;
//! use std::io;
//! use crate::omnijot_file_tar::{pack_cache, extract_to_cache};
//!
//! let cache_dir = std::env::temp_dir().join("example");
//! pack_cache(&cache_dir, File::create("out.ojf")?, true)?;
//! extract_to_cache(File::open("out.ojf")?, &cache_dir, true)?;
//! # Ok::<(), io::Error>(())
//! ```

use std::fs::{self, File};
use std::io::{self, Read, Result, Write};
use std::path::{Component, Path};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use tar::{Archive, Builder};
use walkdir::WalkDir;

/// 将缓存目录内全部文件打包为 tar，可选 gzip 压缩
/// # Arguments
/// * `root`：待打包的缓存目录
/// * `writer`：打包结果的写入目标
/// * `compress`：为 `true` 时额外做 gzip 压缩
pub fn pack_cache<W: Write>(root: &Path, writer: W, compress: bool) -> Result<()> {
    let boxed_writer: Box<dyn Write> = if compress {
        Box::new(GzEncoder::new(writer, Compression::default()))
    } else {
        Box::new(writer)
    };

    let mut builder = Builder::new(boxed_writer);
    for entry in WalkDir::new(root) {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            let rel_path = path.strip_prefix(root).expect("路径应在 root 下");
            builder.append_file(rel_path, &mut File::open(path)?)?;
        }
    }
    builder.finish()?;
    Ok(())
}

/// 将 tar 归档解包到目标目录，支持 gzip 压缩
/// # Arguments
/// * `reader`：`.ojf` 归档的读取源
/// * `target`：解包目标目录，不存在时自动创建
/// * `compressed`：为 `true` 时先做 gzip 解压
pub fn extract_to_cache<R: Read>(reader: R, target: &Path, compressed: bool) -> Result<()> {
    fs::create_dir_all(target)?;
    let boxed_reader: Box<dyn Read> = if compressed {
        Box::new(GzDecoder::new(reader))
    } else {
        Box::new(reader)
    };

    let mut archive = Archive::new(boxed_reader);
    for entry in archive.entries()? {
        let mut entry = entry?;
        let entry_path = entry.path()?.into_owned();
        // .ojf 可能来自外部，拒绝含 `..`、绝对路径或盘符的条目防路径穿越
        if entry_path.components().any(|c| {
            matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_))
        }) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "tar 条目包含不安全的路径",
            ));
        }
        entry.unpack(target.join(entry_path))?;
    }
    Ok(())
}

/// 仅从归档中提取 `meta.json` 内容，不解包其他条目
/// # Arguments
/// * `reader`：`.ojf` 归档的读取源
/// * `compressed`：为 `true` 时先做 gzip 解压
pub fn extract_meta<R: Read>(reader: R, compressed: bool) -> Result<Vec<u8>> {
    let boxed_reader: Box<dyn Read> = if compressed {
        Box::new(GzDecoder::new(reader))
    } else {
        Box::new(reader)
    };

    let mut archive = Archive::new(boxed_reader);
    for entry in archive.entries()? {
        let mut entry = entry?;
        if entry.path()?.ends_with("meta.json") {
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            return Ok(buf);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        "归档中缺少 meta.json",
    ))
}

/// 依据文件头魔数判断 `.ojf` 是否 gzip 压缩
///
/// `path`：`.ojf` 文件路径，返回 `true` 表示 gzip 压缩
pub fn is_ojf_compressed(path: &Path) -> Result<bool> {
    let mut file = File::open(path)?;
    let mut magic = [0u8; 2];
    let read_len = file.read(&mut magic)?;
    Ok(read_len == 2 && magic == [0x1f, 0x8b])
}