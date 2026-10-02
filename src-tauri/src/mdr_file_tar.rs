//! Mindrizzle `.mdrf` 文件的打包与解包。
//!
//! ```no_run
//! use std::fs::File;
//! use std::io;
//! use crate::mdr_file_tar::{pack_cache, extract_to_cache};
//!
//! let cache_dir = std::env::temp_dir().join("example");
//! pack_cache(&cache_dir, File::create("out.mdrf")?, true)?;
//! extract_to_cache(File::open("out.mdrf")?, &cache_dir, true)?;
//! # Ok::<(), io::Error>(())
//! ```

use std::fs::{self, File};
use std::io::{self, Read, Result, Seek, SeekFrom, Write};
use std::path::{Component, Path};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use tar::{Archive, Builder};
use walkdir::WalkDir;

const PROGRESS_COMPLETE: u64 = 100;

/// 将缓存目录内全部文件打包为 tar，可选 gzip 压缩
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

/// 将归档解包到目标目录（不存在时自动创建），可选 gzip 解压
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
        // .mdrf 可能来自外部，拒绝含 `..`、绝对路径或盘符的条目防路径穿越
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

fn archive_total_size<R: Read + Seek>(reader: &mut R, compressed: bool) -> Result<u64> {
    let boxed_reader: Box<dyn Read + '_> = if compressed {
        Box::new(GzDecoder::new(&mut *reader))
    } else {
        Box::new(&mut *reader)
    };
    let mut archive = Archive::new(boxed_reader);
    archive
        .entries()?
        .try_fold(0_u64, |total, entry| Ok(total.saturating_add(entry?.size())))
}

fn validate_archive_entry_path(path: &Path) -> Result<()> {
    let has_unsafe_component = path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    });
    if has_unsafe_component {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "tar 条目包含不安全的路径",
        ));
    }
    Ok(())
}

/// 先统计条目大小才能按解包占比上报进度，所以 reader 需要支持回卷
pub fn extract_to_cache_with_progress<R: Read + Seek>(
    mut reader: R,
    target: &Path,
    compressed: bool,
    mut progress: impl FnMut(u32),
) -> Result<()> {
    fs::create_dir_all(target)?;
    let total_size = archive_total_size(&mut reader, compressed)?;
    reader.seek(SeekFrom::Start(0))?;

    let boxed_reader: Box<dyn Read + '_> = if compressed {
        Box::new(GzDecoder::new(&mut reader))
    } else {
        Box::new(&mut reader)
    };
    let mut archive = Archive::new(boxed_reader);
    let mut extracted_size = 0_u64;
    for entry in archive.entries()? {
        let mut entry = entry?;
        let entry_path = entry.path()?.into_owned();
        validate_archive_entry_path(&entry_path)?;
        extracted_size = extracted_size.saturating_add(entry.size());
        entry.unpack(target.join(entry_path))?;
        if total_size > 0 {
            let percent = (u128::from(extracted_size) * u128::from(PROGRESS_COMPLETE)
                / u128::from(total_size))
            .min(u128::from(PROGRESS_COMPLETE)) as u32;
            progress(percent);
        }
    }
    progress(PROGRESS_COMPLETE as u32);
    Ok(())
}

/// 仅从归档中提取 `meta.json` 内容，不解包其他条目
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

/// 依据文件头魔数判断 `.mdrf` 是否 gzip 压缩
pub fn is_mdrf_compressed(path: &Path) -> Result<bool> {
    let mut file = File::open(path)?;
    let mut magic = [0u8; 2];
    let read_len = file.read(&mut magic)?;
    Ok(read_len == 2 && magic == [0x1f, 0x8b])
}

#[cfg(test)]
mod tests {
    use super::{extract_to_cache_with_progress, PROGRESS_COMPLETE};
    use std::fs;
    use std::io::Cursor;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tar::{Builder, Header};

    #[test]
    fn extracts_archive_and_reports_progress() {
        const FILE_NAME: &str = "body.json";
        const FILE_CONTENT: &[u8] = b"note body";
        const FILE_MODE: u32 = 0o644;

        let mut builder = Builder::new(Vec::new());
        let mut header = Header::new_gnu();
        header.set_size(FILE_CONTENT.len() as u64);
        header.set_mode(FILE_MODE);
        header.set_cksum();
        builder.append_data(&mut header, FILE_NAME, FILE_CONTENT).unwrap();
        let archive = builder.into_inner().unwrap();
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let target = std::env::temp_dir().join(format!("mindrizzle-progress-{unique}"));
        let mut progress = Vec::new();

        extract_to_cache_with_progress(Cursor::new(archive), &target, false, |value| {
            progress.push(value)
        })
        .unwrap();

        assert_eq!(fs::read(target.join(FILE_NAME)).unwrap(), FILE_CONTENT);
        assert_eq!(progress.last(), Some(&(PROGRESS_COMPLETE as u32)));
        fs::remove_dir_all(target).unwrap();
    }
}