  // Live in CoolDesk via the bridge (workspace.list / workspace.open);
  // on the public site it shows demo data.
  var DEMO = [
    { id: "1", name: "Client — Acme", color: "#60a5fa", tabs: 14, apps: 3, last: "2h ago", active: true },
    { id: "2", name: "Side Project", color: "#4ade80", tabs: 9, apps: 2, last: "yesterday" },
    { id: "3", name: "Job Hunt", color: "#f472b6", tabs: 6, apps: 1, last: "3d ago" },
    { id: "4", name: "Learning — Rust", color: "#fbbf24", tabs: 11, apps: 2, last: "1w ago" }
  ];
  function render(list) {
    var box = document.getElementById("rows");
    box.innerHTML = "";
    list.forEach(function (w) {
      var el = document.createElement("div");
      el.className = "ws" + (w.active ? " active" : "");
      var dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = w.color;
      var text = document.createElement("div");
      text.className = "stack grow";
      text.style.gap = "1px";
      var name = document.createElement("span");
      name.style.cssText = "font-size:13px;font-weight:600";
      name.textContent = w.name;
      var meta = document.createElement("span");
      meta.className = "muted";
      meta.style.fontSize = "10px";
      meta.textContent = w.tabs + " tabs · " + w.apps + " apps · " + w.last;
      text.append(name, meta);
      var open = document.createElement("span");
      open.className = "label";
      open.textContent = "Open ›";
      el.append(dot, text, open);
      el.onclick = function () {
        if (cooldesk.hosted) cooldesk.call("workspace.open", { id: w.id });
        else { list.forEach(function (x) { x.active = false; }); w.active = true; render(list); }
      };
      box.appendChild(el);
    });
  }
  cooldesk.onHost = function () {
    document.getElementById("mode").textContent = "Live";
    cooldesk.call("workspace.list").then(render).catch(function () { render(DEMO); });
  };
  render(DEMO);
