  // Live in CoolDesk via the bridge (tabs.stats); demo data on the public site.
  var DEMO = {
    open: 47, duplicates: 12, oldestDays: 3,
    topDomains: [["github.com", 11], ["docs.google.com", 8], ["figma.com", 6], ["stackoverflow.com", 5]]
  };
  function render(s) {
    document.getElementById("open").textContent = s.open;
    document.getElementById("dupes").textContent = s.duplicates;
    document.getElementById("oldest").textContent = s.oldestDays + "d";
    var box = document.getElementById("domains");
    box.innerHTML = "";
    var max = s.topDomains[0][1];
    s.topDomains.forEach(function (d) {
      var el = document.createElement("div");
      el.className = "row";
      var host = document.createElement("span");
      host.className = "muted";
      host.style.cssText = "font-size:11px;width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      host.textContent = d[0];
      var bar = document.createElement("div");
      bar.className = "bar grow";
      var fill = document.createElement("i");
      fill.style.width = (d[1] / max * 100) + "%";
      bar.appendChild(fill);
      var n = document.createElement("span");
      n.className = "mono muted";
      n.style.cssText = "font-size:11px;width:18px;text-align:right";
      n.textContent = String(d[1]);
      el.append(host, bar, n);
      box.appendChild(el);
    });
  }
  cooldesk.onHost = function () {
    document.getElementById("mode").textContent = "Live";
    cooldesk.call("tabs.stats").then(render).catch(function () { render(DEMO); });
  };
  render(DEMO);
