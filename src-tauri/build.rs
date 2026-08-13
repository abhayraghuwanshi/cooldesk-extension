fn main() {
  // SkyLight.framework (used by `dock::cgs` for the private macOS Spaces
  // API — see that module's doc comment) lives under PrivateFrameworks,
  // which isn't on the linker's default framework search path.
  #[cfg(target_os = "macos")]
  println!("cargo:rustc-link-search=framework=/System/Library/PrivateFrameworks");

  tauri_build::build()
}
