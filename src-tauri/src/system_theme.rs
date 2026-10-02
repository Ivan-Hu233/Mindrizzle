use std::path::PathBuf;
#[cfg(target_os = "linux")]
use std::{collections::HashMap, fs};

use image::{DynamicImage, Rgb};
use url::Url;

const COLOR_CHANNEL_BITS: usize = 5;
const COLOR_CHANNEL_LEVELS: usize = 1 << COLOR_CHANNEL_BITS;
const COLOR_BUCKET_COUNT: usize =
    COLOR_CHANNEL_LEVELS * COLOR_CHANNEL_LEVELS * COLOR_CHANNEL_LEVELS;
const COLOR_CHANNEL_STEP: u8 = 1 << (8 - COLOR_CHANNEL_BITS);
const SAMPLE_EDGE: u32 = 64;

#[tauri::command]
pub fn get_wallpaper_primary_color() -> Result<String, String> {
    let wallpaper_path = get_wallpaper_path()?;
    let reader = image::ImageReader::open(&wallpaper_path)
        .map_err(|error| format!("读取桌面壁纸失败：{error}"))?
        .with_guessed_format()
        .map_err(|error| format!("识别桌面壁纸格式失败：{error}"))?;
    let image = reader
        .decode()
        .map_err(|error| format!("解码桌面壁纸失败：{error}"))?;
    Ok(dominant_color(&image))
}

fn get_wallpaper_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    if std::env::var("XDG_CURRENT_DESKTOP")
        .is_ok_and(|desktop| desktop.to_ascii_uppercase().contains("KDE"))
    {
        return get_kde_wallpaper_path();
    }

    let path = wallpaper::get().map_err(|error| format!("读取当前桌面壁纸失败：{error}"))?;
    resolve_wallpaper_path(&path)
}

#[cfg(target_os = "linux")]
fn get_kde_wallpaper_path() -> Result<PathBuf, String> {
    let config_dir = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or_else(|| "找不到 KDE 配置目录".to_owned())?;
    let config_path = config_dir.join("plasma-org.kde.plasma.desktop-appletsrc");
    let config = fs::read_to_string(&config_path)
        .map_err(|error| format!("读取 KDE 桌面配置失败：{error}"))?;
    let wallpaper_uri = find_kde_wallpaper_uri(&config)
        .ok_or_else(|| "KDE 桌面配置中没有找到当前壁纸图片".to_owned())?;
    resolve_wallpaper_path(&wallpaper_uri)
}

#[cfg(target_os = "linux")]
fn find_kde_wallpaper_uri(config: &str) -> Option<String> {
    let sections = parse_kde_config_sections(config);
    for (section, properties) in &sections {
        let Some(containment_id) = section.strip_prefix("Containments][") else {
            continue;
        };
        if containment_id.contains(']')
            || properties.get("formfactor").map(String::as_str) != Some("0")
        {
            continue;
        }
        let Some(plugin) = properties.get("wallpaperplugin") else {
            continue;
        };
        let wallpaper_section = format!("{section}][Wallpaper][{plugin}][General");
        if let Some(uri) = sections
            .iter()
            .find(|(name, _)| name == &wallpaper_section)
            .and_then(|(_, values)| values.get("Image"))
        {
            return Some(uri.clone());
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn parse_kde_config_sections(config: &str) -> Vec<(String, HashMap<String, String>)> {
    let mut sections: Vec<(String, HashMap<String, String>)> = Vec::new();
    for line in config.lines().map(str::trim) {
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|line| line.strip_suffix(']'))
        {
            sections.push((name.to_owned(), HashMap::new()));
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if let Some((_, properties)) = sections.last_mut() {
            properties.insert(key.trim().to_owned(), value.trim().to_owned());
        }
    }
    sections
}

fn resolve_wallpaper_path(value: &str) -> Result<PathBuf, String> {
    let path = if value.starts_with("file://") {
        let url = Url::parse(value).map_err(|error| format!("桌面壁纸路径无效：{error}"))?;
        url.to_file_path()
            .map_err(|_| "桌面壁纸 URI 不是本地文件路径".to_owned())?
    } else {
        PathBuf::from(value)
    };
    if !path.is_file() {
        return Err(format!("桌面壁纸不是可读取的图片文件：{}", path.display()));
    }
    Ok(path)
}

fn dominant_color(image: &DynamicImage) -> String {
    let sample = image.thumbnail(SAMPLE_EDGE, SAMPLE_EDGE).to_rgb8();
    let mut counts = vec![0_u32; COLOR_BUCKET_COUNT];
    for pixel in sample.pixels() {
        counts[color_bucket(*pixel)] += 1;
    }
    let bucket = counts
        .iter()
        .enumerate()
        .max_by_key(|(_, count)| *count)
        .map_or(0, |(index, _)| index);
    bucket_to_hex(bucket)
}

fn color_bucket(pixel: Rgb<u8>) -> usize {
    let red = usize::from(pixel[0] >> (8 - COLOR_CHANNEL_BITS));
    let green = usize::from(pixel[1] >> (8 - COLOR_CHANNEL_BITS));
    let blue = usize::from(pixel[2] >> (8 - COLOR_CHANNEL_BITS));
    (red * COLOR_CHANNEL_LEVELS + green) * COLOR_CHANNEL_LEVELS + blue
}

fn bucket_to_hex(bucket: usize) -> String {
    let blue = (bucket % COLOR_CHANNEL_LEVELS) as u8 * COLOR_CHANNEL_STEP + COLOR_CHANNEL_STEP / 2;
    let green = ((bucket / COLOR_CHANNEL_LEVELS) % COLOR_CHANNEL_LEVELS) as u8 * COLOR_CHANNEL_STEP
        + COLOR_CHANNEL_STEP / 2;
    let red = (bucket / (COLOR_CHANNEL_LEVELS * COLOR_CHANNEL_LEVELS)) as u8 * COLOR_CHANNEL_STEP
        + COLOR_CHANNEL_STEP / 2;
    format!("#{red:02X}{green:02X}{blue:02X}")
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::find_kde_wallpaper_uri;

    #[test]
    fn selects_image_from_active_wallpaper_plugin() {
        let config = "[Containments][1]\nformfactor=0\nwallpaperplugin=org.kde.image\n\
            [Containments][1][Wallpaper][animated.plugin][General]\nImage=/wallpaper/folder\n\
            [Containments][1][Wallpaper][org.kde.image][General]\nImage=file:///wallpaper/current.png\n";

        assert_eq!(
            find_kde_wallpaper_uri(config),
            Some("file:///wallpaper/current.png".to_owned())
        );
    }
}
