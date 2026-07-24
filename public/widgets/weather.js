  // Config: ?lat=&lon=&city= (defaults: Mumbai). Data: open-meteo.com, no API key.
  var lat = cooldesk.get("lat", "19.076");
  var lon = cooldesk.get("lon", "72.877");
  document.getElementById("city").textContent = cooldesk.get("city", "Mumbai");

  var CODES = {
    0: ["☀️", "Clear sky"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
    45: ["🌫️", "Fog"], 48: ["🌫️", "Rime fog"], 51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"],
    55: ["🌧️", "Heavy drizzle"], 61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
    71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 80: ["🌧️", "Showers"],
    81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"], 95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Storm + hail"], 99: ["⛈️", "Storm + hail"]
  };

  function render(c) {
    var info = CODES[c.weather_code] || ["·", "—"];
    document.getElementById("temp").textContent = Math.round(c.temperature_2m) + "°";
    document.getElementById("icon").textContent = info[0];
    document.getElementById("desc").textContent = info[1];
    document.getElementById("wind").textContent = "wind " + Math.round(c.wind_speed_10m) + " km/h";
  }

  // Paint the last reading instantly (stale-while-revalidate), then refresh.
  var cacheKey = "weather:" + lat + "," + lon;
  var last = cooldesk.store.get(cacheKey, null);
  if (last && last.current) render(last.current);

  function load() {
    fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
      "&current=temperature_2m,weather_code,wind_speed_10m")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        render(d.current);
        cooldesk.store.set(cacheKey, { current: d.current, at: Date.now() });
      })
      .catch(function () {
        if (!last) document.getElementById("desc").textContent = "Offline";
      });
  }
  load();
  setInterval(load, 15 * 60 * 1000);
