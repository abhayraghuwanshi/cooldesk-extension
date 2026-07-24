  // The year as a GitHub-style dot grid — a quiet memento mori for your projects.
  var now = new Date();
  var year = now.getFullYear();
  var start = new Date(year, 0, 1);
  var days = (new Date(year + 1, 0, 1) - start) / 86400000;
  var today = Math.floor((now - start) / 86400000);
  var box = document.getElementById("dots");
  // Offset so columns are calendar weeks (Monday-start).
  var offset = (start.getDay() + 6) % 7;
  for (var i = 0; i < offset; i++) {
    var pad = document.createElement("span");
    box.appendChild(pad);
  }
  for (var d = 0; d < days; d++) {
    var el = document.createElement("span");
    el.className = "d" + (d < today ? " past" : d === today ? " today" : "");
    box.appendChild(el);
  }
  document.getElementById("title").textContent = year + " in dots";
  document.getElementById("count").textContent = "day " + (today + 1) + " / " + days;
