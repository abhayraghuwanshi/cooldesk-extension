  var todayKey = new Date().toLocaleDateString("en-CA");
  var state = cooldesk.store.get("focus", {});
  if (state.date !== todayKey) state = { date: todayKey, text: "", done: false };

  var ask = document.getElementById("ask"), show = document.getElementById("show");
  function save() { cooldesk.store.set("focus", state); }
  function render() {
    var has = !!state.text;
    ask.style.display = has ? "none" : "flex";
    show.style.display = has ? "flex" : "none";
    var text = document.getElementById("text");
    text.textContent = state.text;
    text.style.textDecoration = state.done ? "line-through" : "none";
    text.style.color = state.done ? "var(--muted)" : "var(--fg)";
    document.getElementById("done").checked = state.done;
  }
  ask.onsubmit = function (e) {
    e.preventDefault();
    var v = document.getElementById("input").value.trim();
    if (v) { state.text = v; state.done = false; save(); render(); }
  };
  document.getElementById("done").onchange = function () { state.done = this.checked; save(); render(); };
  document.getElementById("text").onclick = function () {
    document.getElementById("input").value = state.text;
    state.text = "";
    save(); render();
    document.getElementById("input").focus();
  };
  render();
