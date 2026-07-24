  var links = cooldesk.store.get("links", [
    { name: "GitHub", url: "https://github.com" },
    { name: "Gmail", url: "https://mail.google.com" },
    { name: "YouTube", url: "https://youtube.com" },
    { name: "HN", url: "https://news.ycombinator.com" }
  ]);
  function save() { cooldesk.store.set("links", links); }
  function render() {
    var grid = document.getElementById("grid");
    grid.innerHTML = "";
    links.forEach(function (l, i) {
      var a = document.createElement("a");
      a.className = "tile";
      a.href = l.url;
      a.target = "_blank";
      a.rel = "noopener";
      var glyph = document.createElement("div");
      glyph.className = "glyph";
      glyph.textContent = (l.name || "?").slice(0, 1).toUpperCase();
      var span = document.createElement("span");
      span.textContent = l.name;
      var del = document.createElement("button");
      del.className = "ghost";
      del.textContent = "×";
      del.onclick = function (e) { e.preventDefault(); links.splice(i, 1); save(); render(); };
      a.append(glyph, span, del);
      grid.appendChild(a);
    });
  }
  document.getElementById("add").onclick = function () {
    var f = document.getElementById("form");
    f.style.display = f.style.display === "none" ? "flex" : "none";
  };
  document.getElementById("form").onsubmit = function (e) {
    e.preventDefault();
    var url = document.getElementById("url").value.trim();
    var name = document.getElementById("name").value.trim() || new URL(url).hostname.replace("www.", "");
    links.push({ name: name, url: url });
    save(); render();
    this.reset();
    this.style.display = "none";
  };
  render();
