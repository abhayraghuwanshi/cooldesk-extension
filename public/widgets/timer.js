  var mode = "timer", running = false, timer = null;
  var timerLeft = 300, timerTotal = 300, watchMs = 0, lastTick = 0;

  function fmtT(s) { return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(Math.floor(s % 60)).padStart(2, "0"); }
  function fmtW(ms) {
    var s = ms / 1000;
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(Math.floor(s % 60)).padStart(2, "0") +
      '.' + String(Math.floor((ms % 1000) / 100));
  }
  function render() {
    document.getElementById("display").textContent = mode === "timer" ? fmtT(timerLeft) : fmtW(watchMs);
    document.getElementById("toggle").textContent = running ? "Pause" : "Start";
    document.getElementById("presets").style.visibility = mode === "timer" ? "visible" : "hidden";
    document.getElementById("tabTimer").className = mode === "timer" ? "" : "ghost";
    document.getElementById("tabWatch").className = mode === "watch" ? "" : "ghost";
  }
  function stop() { running = false; clearInterval(timer); }
  function tick() {
    if (mode === "timer") {
      if (--timerLeft <= 0) { timerLeft = 0; stop(); }
    } else {
      var now = Date.now();
      watchMs += now - lastTick;
      lastTick = now;
    }
    render();
  }
  function setMode(m) { stop(); mode = m; render(); }
  document.getElementById("tabTimer").onclick = function () { setMode("timer"); };
  document.getElementById("tabWatch").onclick = function () { setMode("watch"); };
  document.getElementById("toggle").onclick = function () {
    running = !running;
    if (running) { lastTick = Date.now(); timer = setInterval(tick, mode === "timer" ? 1000 : 100); }
    else clearInterval(timer);
    render();
  };
  document.getElementById("reset").onclick = function () {
    stop();
    if (mode === "timer") timerLeft = timerTotal; else watchMs = 0;
    render();
  };
  Array.prototype.forEach.call(document.querySelectorAll("[data-min]"), function (b) {
    b.onclick = function () { stop(); timerTotal = timerLeft = parseInt(b.dataset.min, 10) * 60; render(); };
  });
  document.getElementById("custom").onchange = function () {
    var v = parseInt(this.value, 10);
    if (v > 0) { stop(); timerTotal = timerLeft = v * 60; render(); }
  };
  render();
