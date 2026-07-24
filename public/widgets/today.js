  function isoWeek(d) {
    var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  }
  function tick() {
    var now = new Date();
    document.getElementById("day").textContent = now.toLocaleDateString("en-US", { weekday: "long" });
    document.getElementById("date").textContent = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    document.getElementById("week").textContent = "Week " + isoWeek(now);
    var pct = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 864;
    document.getElementById("fill").style.width = pct + "%";
    document.getElementById("pct").textContent = pct.toFixed(1) + "%";
  }
  tick();
  setInterval(tick, 30000);
