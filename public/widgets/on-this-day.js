  // Events: Wikipedia's REST feed (en.wikipedia.org, CORS-open, no key).
  var now = new Date();
  var mm = String(now.getMonth() + 1).padStart(2, "0");
  var dd = String(now.getDate()).padStart(2, "0");
  document.getElementById("title").textContent =
    "On this day · " + now.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  var events = [], i = 0;
  function show() {
    if (!events.length) return;
    var e = events[i % events.length];
    document.getElementById("year").textContent = e.year;
    document.getElementById("text").textContent = e.text;
    i++;
  }
  fetch("https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/" + mm + "/" + dd)
    .then(function (r) { return r.json(); })
    .then(function (d) {
      events = (d.events || []).filter(function (e) { return e.text && e.text.length < 220; });
      i = Math.floor(Math.random() * events.length);
      show();
    })
    .catch(function () { document.getElementById("text").textContent = "Offline — no history today."; });
  document.getElementById("box").onclick = show;
