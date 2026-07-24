  // ?since=YYYY-MM-DD&label=… or set inline (stored locally).
  var state = cooldesk.store.get("streak", {
    label: cooldesk.get("label", "Streak"),
    since: cooldesk.get("since", new Date().toLocaleDateString("en-CA"))
  });
  if (cooldesk.params.get("since")) state.since = cooldesk.params.get("since");
  if (cooldesk.params.get("label")) state.label = cooldesk.params.get("label");

  function render() {
    var start = new Date(state.since + "T00:00:00");
    var days = Math.max(0, Math.floor((Date.now() - start) / 86400000));
    document.getElementById("days").textContent = days;
    document.getElementById("title").textContent = state.label + " · since " +
      start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  document.getElementById("form").onsubmit = function (e) {
    e.preventDefault();
    var label = document.getElementById("label").value.trim();
    var date = document.getElementById("date").value;
    if (label) state.label = label;
    if (date) state.since = date;
    cooldesk.store.set("streak", state);
    render();
  };
  render();
  setInterval(render, 60 * 60 * 1000);
