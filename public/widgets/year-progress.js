  function tick() {
    var now = new Date();
    var y = now.getFullYear();
    var start = new Date(y, 0, 1), end = new Date(y + 1, 0, 1);
    var pct = (now - start) / (end - start) * 100;
    var daysLeft = Math.ceil((end - now) / 86400000);
    var mStart = new Date(y, now.getMonth(), 1), mEnd = new Date(y, now.getMonth() + 1, 1);
    document.getElementById("pct").textContent = pct.toFixed(1) + "%";
    document.getElementById("year").textContent = String(y);
    document.getElementById("fill").style.width = pct + "%";
    document.getElementById("left").textContent = daysLeft + " days left";
    document.getElementById("month").textContent =
      now.toLocaleDateString("en-US", { month: "short" }) + " " + Math.round((now - mStart) / (mEnd - mStart) * 100) + "%";
  }
  tick();
  setInterval(tick, 60000);
