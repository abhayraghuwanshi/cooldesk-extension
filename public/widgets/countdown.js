  // ?to=YYYY-MM-DD (or full ISO) & label=Event name. Defaults to next New Year.
  var label = cooldesk.get("label", "New Year");
  var to = cooldesk.get("to", (new Date().getFullYear() + 1) + "-01-01");
  var target = new Date(to.length === 10 ? to + "T00:00:00" : to);
  document.getElementById("title").textContent = label;

  var units = document.getElementById("units");
  ["days", "hrs", "min", "sec"].forEach(function (u) {
    var el = document.createElement("div");
    el.className = "stack center";
    el.style.gap = "4px";
    el.innerHTML = '<span class="big mono" style="font-size:34px" data-v>0</span><span class="label">' + u + "</span>";
    units.appendChild(el);
  });
  var vals = document.querySelectorAll("[data-v]");

  function tick() {
    var ms = target - Date.now();
    if (ms <= 0) {
      document.getElementById("title").textContent = label + " — it's here 🎉";
      ms = 0;
    }
    var s = Math.floor(ms / 1000);
    var parts = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
    parts.forEach(function (v, i) { vals[i].textContent = i === 0 ? v : String(v).padStart(2, "0"); });
  }
  tick();
  setInterval(tick, 1000);
