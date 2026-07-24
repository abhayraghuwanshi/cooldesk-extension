  // Chart image: ghchart.rshah.org (public service rendering GitHub's contribution graph).
  var user = cooldesk.get("user", cooldesk.store.get("gh-user", "torvalds"));
  var img = document.getElementById("chart");
  function render() {
    document.getElementById("title").textContent = "GitHub · " + user;
    img.src = "https://ghchart.rshah.org/2563eb/" + encodeURIComponent(user);
  }
  img.onerror = function () {
    document.getElementById("chartBox").innerHTML = '<span class="muted" style="font-size:12px">Could not load chart</span>';
  };
  document.getElementById("form").onsubmit = function (e) {
    e.preventDefault();
    var v = document.getElementById("user").value.trim();
    if (v) { user = v; cooldesk.store.set("gh-user", v); render(); }
  };
  render();
