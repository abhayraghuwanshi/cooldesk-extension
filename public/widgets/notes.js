  var pad = document.getElementById("pad");
  var status = document.getElementById("status");
  pad.value = cooldesk.store.get("notes", "");
  var t = null;
  pad.oninput = function () {
    status.textContent = "…";
    clearTimeout(t);
    t = setTimeout(function () {
      cooldesk.store.set("notes", pad.value);
      status.textContent = "Saved";
      setTimeout(function () { status.textContent = ""; }, 1200);
    }, 400);
  };
