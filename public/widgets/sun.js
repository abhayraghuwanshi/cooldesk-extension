  // ?lat=&lon=&city= — same params as the weather widget. Data: open-meteo.com.
  var lat = cooldesk.get("lat", "19.076");
  var lon = cooldesk.get("lon", "72.877");
  document.getElementById("city").textContent = "Sun · " + cooldesk.get("city", "Mumbai");

  function render(sunrise, sunset) {
    var rise = new Date(sunrise);
    var set = new Date(sunset);
    var fmt = function (t) { return t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };
    document.getElementById("rise").textContent = fmt(rise);
    document.getElementById("set").textContent = fmt(set);
    var lenMs = set - rise;
    document.getElementById("len").textContent =
      "Daylight " + Math.floor(lenMs / 3600000) + "h " + Math.round(lenMs % 3600000 / 60000) + "m";
    var pct = (Date.now() - rise) / lenMs * 100;
    document.getElementById("fill").style.width = Math.max(0, Math.min(100, pct)) + "%";
  }

  // Sun times only change day to day — today's cached value is exact.
  var cacheKey = "sun:" + lat + "," + lon;
  var today = new Date().toDateString();
  var last = cooldesk.store.get(cacheKey, null);
  if (last && last.day === today) {
    render(last.sunrise, last.sunset);
  } else {
    fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
      "&daily=sunrise,sunset&timezone=auto&forecast_days=1")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        render(d.daily.sunrise[0], d.daily.sunset[0]);
        cooldesk.store.set(cacheKey, { day: today, sunrise: d.daily.sunrise[0], sunset: d.daily.sunset[0] });
      })
      .catch(function () { document.getElementById("len").textContent = "Offline"; });
  }
