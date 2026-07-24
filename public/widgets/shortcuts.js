  var SHORTCUTS = [
    [["Alt", "K"], "Open CoolDesk Spotlight — search tabs, apps, notes and files from anywhere", "CoolDesk"],
    [["Ctrl", "Shift", "T"], "Reopen the tab you just closed (works repeatedly)", "Browser"],
    [["Ctrl", "Shift", "P"], "Command palette — every command, searchable", "VS Code"],
    [["Ctrl", "L"], "Jump to the address bar without touching the mouse", "Browser"],
    [["Win", "V"], "Clipboard history — everything you copied, not just the last thing", "Windows"],
    [["Ctrl", "D"], "Select next occurrence of the current word (multi-cursor)", "VS Code"],
    [["Ctrl", "Shift", "A"], "Search your open tabs by name", "Chrome"],
    [["Win", "Shift", "S"], "Screenshot any region of the screen", "Windows"],
    [["Ctrl", "K", "Z"], "Zen mode — hide everything but the code", "VS Code"],
    [["Ctrl", "Shift", "V"], "Paste without formatting", "Everywhere"],
    [["Alt", "Tab"], "Hold Alt and keep tapping Tab to walk through windows", "Windows"],
    [["Ctrl", "`"], "Toggle the integrated terminal", "VS Code"],
    [["F2"], "Rename symbol everywhere it's used", "VS Code"],
    [["Ctrl", "W"], "Close the current tab — and Ctrl+Shift+T undoes it", "Browser"]
  ];
  // Day-of-year keeps the daily pick stable; Next cycles.
  var start = new Date(new Date().getFullYear(), 0, 0);
  var i = Math.floor((Date.now() - start) / 86400000) % SHORTCUTS.length;
  function render() {
    var s = SHORTCUTS[i % SHORTCUTS.length];
    var keys = document.getElementById("keys");
    keys.innerHTML = "";
    s[0].forEach(function (k, n) {
      if (n > 0) keys.insertAdjacentHTML("beforeend", '<span class="muted">+</span>');
      var kbd = document.createElement("kbd");
      kbd.textContent = k;
      keys.appendChild(kbd);
    });
    document.getElementById("what").textContent = s[1];
    document.getElementById("app").textContent = s[2];
  }
  document.getElementById("next").onclick = function () { i++; render(); };
  render();
