use std::process::Command;

fn watch_git_path(git_ref: &str) {
    if let Some(path) = Command::new("git")
        .args(["rev-parse", "--git-path", git_ref])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
    {
        println!("cargo:rerun-if-changed={path}");
    }
}

fn main() {
    watch_git_path("HEAD");
    if let Some(git_ref) = Command::new("git")
        .args(["symbolic-ref", "--quiet", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
    {
        watch_git_path(&git_ref);
    }
    let commit = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|commit| !commit.is_empty())
        .unwrap_or_else(|| "unknown".to_owned());
    println!("cargo:rustc-env=GIT_COMMIT={commit}");
    tauri_build::build()
}
