  // Box breathing: inhale 4s, hold 4s, exhale 4s, hold 4s.
  var PHASES = [["Breathe in", true], ["Hold", true], ["Breathe out", false], ["Hold", false]];
  var running = false, step = 0, timer = null;
  var orb = document.getElementById("orb"), phase = document.getElementById("phase");
  function advance() {
    var p = PHASES[step % 4];
    phase.textContent = p[0];
    orb.className = "orb" + (p[1] ? " in" : "");
    step++;
  }
  document.getElementById("toggle").onclick = function () {
    running = !running;
    this.textContent = running ? "Stop" : "Start";
    if (running) { step = 0; advance(); timer = setInterval(advance, 4000); }
    else {
      clearInterval(timer);
      orb.className = "orb";
      phase.textContent = "Box breathing · 4-4-4-4";
    }
  };
