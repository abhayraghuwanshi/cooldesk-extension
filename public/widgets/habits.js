  var habits = cooldesk.store.get("habits", [
    { name: "Deep work", days: {} },
    { name: "Exercise", days: {} }
  ]);
  function save() { cooldesk.store.set("habits", habits); }

  // Monday-start week of today.
  var today = new Date();
  var monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  var week = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(monday);
    d.setDate(monday.getDate() + i);
    week.push(d.toLocaleDateString("en-CA"));
  }
  var todayKey = today.toLocaleDateString("en-CA");
  document.getElementById("days").textContent = "M T W T F S S";

  function render() {
    var box = document.getElementById("rows");
    box.innerHTML = "";
    habits.forEach(function (h, hi) {
      var row = document.createElement("div");
      row.className = "hrow";
      var name = document.createElement("span");
      name.className = "hname";
      name.textContent = h.name;
      row.appendChild(name);
      week.forEach(function (key) {
        var dot = document.createElement("button");
        dot.className = "dot" + (h.days[key] ? " on" : "") + (key === todayKey ? " today" : "");
        dot.onclick = function () {
          if (h.days[key]) delete h.days[key]; else h.days[key] = true;
          save(); render();
        };
        row.appendChild(dot);
      });
      var del = document.createElement("button");
      del.className = "ghost del";
      del.textContent = "×";
      del.onclick = function () { habits.splice(hi, 1); save(); render(); };
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  document.getElementById("form").onsubmit = function (e) {
    e.preventDefault();
    var input = document.getElementById("input");
    var name = input.value.trim();
    if (name) { habits.push({ name: name, days: {} }); input.value = ""; save(); render(); }
  };
  render();
