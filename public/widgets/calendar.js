  var view = new Date();
  view.setDate(1);
  function render() {
    var cal = document.getElementById("cal");
    cal.innerHTML = "";
    ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach(function (d) {
      var el = document.createElement("div");
      el.className = "h";
      el.textContent = d;
      cal.appendChild(el);
    });
    document.getElementById("title").textContent =
      view.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    var firstDow = (view.getDay() + 6) % 7; // Monday-start
    var daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    var daysInPrev = new Date(view.getFullYear(), view.getMonth(), 0).getDate();
    var today = new Date();
    var isThisMonth = today.getFullYear() === view.getFullYear() && today.getMonth() === view.getMonth();
    var cells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
    for (var i = 0; i < cells; i++) {
      var el = document.createElement("div");
      var n = i - firstDow + 1;
      el.className = "d";
      if (n < 1) { el.textContent = daysInPrev + n; el.className += " dim"; }
      else if (n > daysInMonth) { el.textContent = n - daysInMonth; el.className += " dim"; }
      else {
        el.textContent = n;
        if (isThisMonth && n === today.getDate()) el.className += " today";
      }
      cal.appendChild(el);
    }
  }
  document.getElementById("prev").onclick = function () { view.setMonth(view.getMonth() - 1); render(); };
  document.getElementById("next").onclick = function () { view.setMonth(view.getMonth() + 1); render(); };
  render();
