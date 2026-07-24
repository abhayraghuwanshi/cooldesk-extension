  // Generated locally with crypto.getRandomValues; nothing leaves the page.
  var LOWER = "abcdefghijkmnopqrstuvwxyz", UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  var DIGITS = "23456789", SYMBOLS = "!@#$%^&*-_=+?";
  var current = "";
  function generate() {
    var pool = LOWER + UPPER;
    if (document.getElementById("digits").checked) pool += DIGITS;
    if (document.getElementById("symbols").checked) pool += SYMBOLS;
    var len = parseInt(document.getElementById("len").value, 10);
    document.getElementById("lenLabel").textContent = len;
    var bytes = new Uint32Array(len);
    crypto.getRandomValues(bytes);
    current = "";
    for (var i = 0; i < len; i++) current += pool[bytes[i] % pool.length];
    document.getElementById("output").textContent = current;
  }
  function copy() {
    navigator.clipboard.writeText(current).then(function () {
      var btn = document.getElementById("copy");
      btn.textContent = "Copied ✓";
      setTimeout(function () { btn.textContent = "Copy"; }, 1200);
    });
  }
  document.getElementById("len").oninput = generate;
  document.getElementById("digits").onchange = generate;
  document.getElementById("symbols").onchange = generate;
  document.getElementById("gen").onclick = generate;
  document.getElementById("copy").onclick = copy;
  document.getElementById("output").onclick = copy;
  generate();
