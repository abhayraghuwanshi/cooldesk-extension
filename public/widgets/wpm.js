  var SENTENCES = [
    "The quick brown fox jumps over the lazy dog while the launcher restores every tab.",
    "Ship small improvements every day and the compound interest takes care of the rest.",
    "A tidy workspace is not about fewer tabs but about knowing where everything lives.",
    "Context switching is expensive so keep each project in its own little universe.",
    "Good tools disappear into the work and only bad ones demand your attention."
  ];
  var target, started, timer, best = cooldesk.store.get("wpm-best", 0);
  var input = document.getElementById("input");
  function reset() {
    target = SENTENCES[Math.floor(Math.random() * SENTENCES.length)];
    document.getElementById("target").textContent = target;
    document.getElementById("clock").textContent = "15.0";
    document.getElementById("result").textContent = best ? "Best: " + best + " wpm" : "";
    input.value = "";
    input.disabled = false;
    started = null;
    clearInterval(timer);
  }
  function finish() {
    clearInterval(timer);
    input.disabled = true;
    var typed = input.value;
    var correct = 0;
    for (var i = 0; i < typed.length; i++) if (typed[i] === target[i]) correct++;
    var wpm = Math.round((correct / 5) / (15 / 60));
    var acc = typed.length ? Math.round(correct / typed.length * 100) : 0;
    if (wpm > best) { best = wpm; cooldesk.store.set("wpm-best", best); }
    document.getElementById("result").textContent = wpm + " wpm · " + acc + "% · best " + best;
  }
  input.oninput = function () {
    if (!started) {
      started = Date.now();
      timer = setInterval(function () {
        var left = 15 - (Date.now() - started) / 1000;
        document.getElementById("clock").textContent = Math.max(0, left).toFixed(1);
        if (left <= 0) finish();
      }, 100);
    }
    if (input.value === target) finish();
  };
  document.getElementById("retry").onclick = reset;
  reset();
