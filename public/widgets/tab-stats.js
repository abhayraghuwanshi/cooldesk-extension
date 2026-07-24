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
      el.innerHTML = '<span class="muted" style="font-size:11px;width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        d[0] + '</span><div class="bar grow"><i style="width:' + (d[1] / max * 100) + '%"></i></div>' +
        '<span class="mono muted" style="font-size:11px;width:18px;text-align:right">' + d[1] + "</span>";
      box.appendChild(el);
    });
  }
  cooldesk.onHost = function () {
    document.getElementById("mode").textContent = "Live";
    cooldesk.call("tabs.stats").then(render).catch(function () { render(DEMO); });
  };
  render(DEMO);
