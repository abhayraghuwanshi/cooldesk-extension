  var engine = document.getElementById("engine");
  engine.value = cooldesk.store.get("engine", engine.value);
  engine.onchange = function () { cooldesk.store.set("engine", engine.value); };
  document.getElementById("form").onsubmit = function (e) {
    e.preventDefault();
    var q = document.getElementById("q").value.trim();
    if (q) window.open(engine.value + encodeURIComponent(q), "_blank", "noopener");
  };
