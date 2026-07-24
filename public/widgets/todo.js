  var tasks = cooldesk.store.get("todo", [
    { text: "Try CoolDesk widgets", done: false },
    { text: "Plan the week", done: false }
  ]);
  function save() { cooldesk.store.set("todo", tasks); }
  function render() {
    var box = document.getElementById("items");
    box.innerHTML = "";
    tasks.forEach(function (t, i) {
      var el = document.createElement("div");
      el.className = "task" + (t.done ? " done" : "");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = t.done;
      cb.onchange = function () { t.done = cb.checked; save(); render(); };
      var span = document.createElement("span");
      span.className = "grow";
      span.textContent = t.text;
      var del = document.createElement("button");
      del.className = "ghost";
      del.textContent = "×";
      del.onclick = function () { tasks.splice(i, 1); save(); render(); };
      el.append(cb, span, del);
      box.appendChild(el);
    });
  }
  document.getElementById("form").onsubmit = function (e) {
    e.preventDefault();
    var input = document.getElementById("input");
    var text = input.value.trim();
    if (text) { tasks.unshift({ text: text, done: false }); input.value = ""; save(); render(); }
  };
  document.getElementById("clear").onclick = function () {
    tasks = tasks.filter(function (t) { return !t.done; });
    save(); render();
  };
  render();
