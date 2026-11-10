  var T = cooldesk.t;
  var FOCUS = parseInt(cooldesk.get("focus", "25"), 10) * 60;
  var BREAK = parseInt(cooldesk.get("break", "5"), 10) * 60;
  var isFocus = true, left = FOCUS, running = false, session = 1, timer = null;

  function fmt(s) { return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  function render() {
    document.getElementById("time").textContent = fmt(left);
    document.getElementById("phase").textContent = isFocus ? T("Focus") : T("Break");
    document.getElementById("count").textContent = T("Session {n}", { n: session });
    document.getElementById("fill").style.width = (left / (isFocus ? FOCUS : BREAK) * 100) + "%";
    document.getElementById("toggle").textContent = running ? T("Pause") : T("Start");
    document.title = fmt(left) + (isFocus ? " Focus" : " Break");
  }
  function switchPhase() {
    if (isFocus) session++;
    isFocus = !isFocus;
    left = isFocus ? FOCUS : BREAK;
  }
  function tick() {
    if (--left <= 0) switchPhase();
    render();
  }
  document.getElementById("toggle").onclick = function () {
    running = !running;
    if (running) timer = setInterval(tick, 1000); else clearInterval(timer);
    render();
  };
  document.getElementById("skip").onclick = function () { switchPhase(); render(); };
  document.getElementById("reset").onclick = function () {
    clearInterval(timer); running = false; isFocus = true; left = FOCUS; session = 1; render();
  };
  render();
