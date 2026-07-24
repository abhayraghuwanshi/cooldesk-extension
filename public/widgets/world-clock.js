  // ?cities=Label:IANA_Zone,Label:Zone — defaults cover common remote-work hubs.
  var raw = cooldesk.get("cities",
    "San Francisco:America/Los_Angeles,New York:America/New_York,London:Europe/London,Mumbai:Asia/Kolkata,Tokyo:Asia/Tokyo");
  var cities = raw.split(",").map(function (pair) {
    var i = pair.indexOf(":");
    return { name: pair.slice(0, i), zone: pair.slice(i + 1) };
  });
  var rows = document.getElementById("rows");
  cities.forEach(function (c) {
    var el = document.createElement("div");
    el.className = "row spread";
    el.innerHTML = '<span class="grow" style="font-size:13px">' + c.name +
      '</span><span class="mono muted" style="font-size:11px" data-day></span>' +
      '<span class="big mono" style="font-size:18px" data-time></span>';
    rows.appendChild(el);
    c.timeEl = el.querySelector("[data-time]");
    c.dayEl = el.querySelector("[data-day]");
  });
  function tick() {
    var now = new Date();
    var todayHere = now.toLocaleDateString("en-CA");
    cities.forEach(function (c) {
      try {
        c.timeEl.textContent = now.toLocaleTimeString("en-GB", { timeZone: c.zone, hour: "2-digit", minute: "2-digit" });
        var thereDate = now.toLocaleDateString("en-CA", { timeZone: c.zone });
        c.dayEl.textContent = thereDate === todayHere ? "" : (thereDate > todayHere ? "+1d" : "-1d");
      } catch (e) {
        c.timeEl.textContent = "--:--";
      }
    });
  }
  tick();
  setInterval(tick, 15000);
