  var goal = parseInt(cooldesk.get("goal", "8"), 10);
  var todayKey = new Date().toLocaleDateString("en-CA");
  var state = cooldesk.store.get("water", {});
  if (state.date !== todayKey) state = { date: todayKey, n: 0 };

  function save() { cooldesk.store.set("water", state); }
  function render() {
    var box = document.getElementById("glasses");
    box.innerHTML = "";
    for (var i = 0; i < Math.max(goal, state.n); i++) {
      var g = document.createElement("div");
      g.className = "glass" + (i < state.n ? " full" : "");
      box.appendChild(g);
    }
    document.getElementById("count").textContent = state.n + " / " + goal +
      (state.n >= goal ? " · Done 💧" : "");
  }
  document.getElementById("add").onclick = function () { state.n++; save(); render(); };
  document.getElementById("minus").onclick = function () { if (state.n > 0) state.n--; save(); render(); };
  render();
