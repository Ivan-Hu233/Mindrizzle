use platform_dirs::{UserDirs};

pub fn get_hn_dir() -> std::path::PathBuf{
  let path = UserDirs::new().unwrap().document_dir.join("Nope");
  if !path.exists(){
    std::fs::create_dir(&path).unwrap();
  }
  path
}