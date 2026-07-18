use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use chrono::Local;
use quick_xml::se::to_string;
use quick_xml::de::from_str;

use crate::hn_fs;
use crate::hn_struct::HyperNote;

pub fn get_hypernote(file_name: String) -> Result<HyperNote, &'static str> {
    let path = hn_fs::get_hn_file_dir(file_name);
    if !path.is_file() {
        return Err("文件不存在或者是个目录");
    }
    let data = std::fs::read_to_string(path).unwrap();
    let result = deserialize_hn_xml(&data);
    if let Ok(data) = result  {
        Ok(data)
    }
    else {
        Err("解码时出现错误")
    }
}

#[tauri::command]
pub fn create_hypernote(hypernote_info: HyperNote, file_name: String) -> Result<PathBuf, String>{
    let file_path: PathBuf = if file_name.as_str().is_empty() {
        let now = Local::now();
        let timestamp = now.format("%Y-%m-%d_%H-%M-%S").to_string();
        hn_fs::get_hn_file_dir(format!("我的笔记_{}", timestamp))
    } else {
        hn_fs::get_hn_file_dir(file_name)
    };

    let mut file = File::create(&file_path).unwrap();
    if let Ok(hn) = serialize_hn_xml(hypernote_info) {
        file.write_all(hn.as_bytes()).unwrap();
    }
    Ok(file_path)
}

fn deserialize_hn_xml(xml: &str) -> Result<HyperNote, quick_xml::DeError> {
    from_str(xml)
}

fn serialize_hn_xml(hn: HyperNote) -> Result<String, quick_xml::SeError> {
    to_string(&hn)
}