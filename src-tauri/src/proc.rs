//! Spawning child processes without opening a console window.
//!
//! Use `proc::command(..)` instead of `std::process::Command::new(..)` for any
//! child that isn't itself a GUI application. The reason is Windows-specific,
//! and the fact that it is Windows-specific is exactly why it keeps being
//! forgotten:
//!
//! A Windows executable declares in its PE header whether it is a GUI or a
//! CONSOLE program, and a CONSOLE program is required to have a console
//! attached. This app is GUI-subsystem and owns no console, so when it spawns
//! something like `git.exe` the kernel *creates a new console for the child*.
//! On Windows 11 the "Default terminal application" setting then decides what
//! that console looks like: with the default set to Windows Terminal, the
//! console is handed off over DCOM and materialises a real terminal window. A
//! background `git status` therefore opens a window in the user's face, and
//! polling a few folders opens dozens of them.
//!
//! `CREATE_NO_WINDOW` keeps the console headless, which suppresses both the
//! window and the handoff. It does not stop a `conhost.exe` from being created
//! — that is normal and invisible.
//!
//! macOS and Linux have no subsystem bit and no notion of a console being
//! attached to a process: `posix_spawn` gives the child exactly the file
//! descriptors it was handed, and nothing ever launches Terminal.app on its
//! own. So the unflagged code is completely silent there, and a Windows-only
//! regression ships without anyone noticing. Going through this helper means
//! the difference stops mattering at the call site.

use std::ffi::OsStr;
use std::process::Command;

/// A `Command` that will not pop up a console window on Windows.
///
/// Drop-in for `Command::new`; on non-Windows targets it is exactly that.
pub fn command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /// Run the child without a console window (winbase.h `CREATE_NO_WINDOW`).
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
