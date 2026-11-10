  var T = cooldesk.t;
  // Events: Wikipedia's REST feed (en.wikipedia.org, CORS-open, no key).
  var now = new Date();
  var mm = String(now.getMonth() + 1).padStart(2, "0");
  var dd = String(now.getDate()).padStart(2, "0");
  document.getElementById("title").textContent =
    T("On this day") + " · " + now.toLocaleDateString(cooldesk.locale, { month: "short", day: "numeric" });

  var events = [], i = 0;
  function show() {
    if (!events.length) return;
    var e = events[i % events.length];
    document.getElementById("year").textContent = e.year;
    document.getElementById("text").textContent = e.text;
    i++;
  }
  // The widget's language first (not every Wikipedia has this feed), then English.
  function feed(wiki) {
    return fetch("https://" + wiki + ".wikipedia.org/api/rest_v1/feed/onthisday/events/" + mm + "/" + dd)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        var list = (d.events || []).filter(function (e) { return e.text && e.text.length < 220; });
        if (!list.length) throw new Error("empty");
        return list;
      });
  }
  (cooldesk.lang === "en" ? feed("en") : feed(cooldesk.lang).catch(function () { return feed("en"); }))
    .then(function (list) {
      events = list;
      i = Math.floor(Math.random() * events.length);
      show();
    })
    .catch(function () { document.getElementById("text").textContent = T("Offline — no history today."); });
  document.getElementById("box").onclick = show;
