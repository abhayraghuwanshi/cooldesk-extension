  var snippets = cooldesk.store.get("snippets", [
    { name: "Email", text: "you@example.com" },
    { name: "Meet link", text: "https://meet.google.com/your-room" },
    { name: "Shrug", text: "¯\\_(ツ)_/¯" }
  ]);
  function save() { cooldesk.store.set("snippets", snippets); }
  function flash(msg) {
    var s = document.getElementById("status");
    s.textContent = msg;
    setTimeout(function () { s.textContent = "Snippets — click to copy"; }, 1300);
  }
  function render() {
    var box = document.getElementById("rows");
    box.innerHTML = "";
    snippets.forEach(function (sn, i) {
      var el = document.createElement("div");
      el.className = "snip";
      var name = document.createElement("span");
      name.style.cssText = "font-size:12px;font-weight:600;width:88px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      name.textContent = sn.name;
      var preview = document.createElement("span");
      preview.className = "muted grow mono";
      preview.style.cssText = "font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      preview.textContent = sn.text;
      var del = document.createElement("button");
      del.className = "ghost del";
      del.textContent = "×";
      del.onclick = function (e) { e.stopPropagation(); snippets.splice(i, 1); save(); render(); };
      el.append(name, preview, del);
      el.onclick = function () {
        navigator.clipboard.writeText(sn.text).then(function () { flash("Copied “" + sn.name + "” ✓"); });
      };
      box.appendChild(el);
    });
  }
  document.getElementById("add").onclick = function () {
    var f = document.getElementById("form");
    f.style.display = f.style.display === "none" ? "flex" : "none";
  };
  document.getElementById("form").onsubmit = function (e) {
    e.preventDefault();
    snippets.unshift({
      name: document.getElementById("name").value.trim(),
      text: document.getElementById("text").value
    });
    save(); render();
    this.reset();
    this.style.display = "none";
  };
  render();
