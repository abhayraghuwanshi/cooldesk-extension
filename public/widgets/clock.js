  var tz = cooldesk.get("tz", undefined);
  var h12 = cooldesk.get("h12", "0") === "1";
  function tick() {
    var now = new Date();
    var opts = tz ? { timeZone: tz } : {};
    document.getElementById("time").textContent = now.toLocaleTimeString("en-GB",
      Object.assign({ hour: "2-digit", minute: "2-digit", hour12: h12 }, opts));
    document.getElementById("sec").textContent = now.toLocaleTimeString("en-GB",
      Object.assign({ second: "2-digit" }, opts)) + (h12 ? " " + now.toLocaleTimeString("en-US", Object.assign({ hour12: true }, opts)).slice(-2) : "");
    document.getElementById("date").textContent = now.toLocaleDateString("en-US",
      Object.assign({ weekday: "long", month: "long", day: "numeric" }, opts));
  }
  tick();
  setInterval(tick, 1000);
