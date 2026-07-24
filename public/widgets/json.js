  // Runs entirely locally — nothing is uploaded anywhere.
  var input = document.getElementById("input"), output = document.getElementById("output");
  var status = document.getElementById("status");
  function run(spacing) {
    try {
      var parsed = JSON.parse(input.value);
      output.value = JSON.stringify(parsed, null, spacing);
      status.textContent = "Valid ✓";
      status.style.color = "var(--good)";
    } catch (e) {
      output.value = "";
      status.textContent = String(e.message).slice(0, 48);
      status.style.color = "var(--bad)";
    }
  }
  document.getElementById("format").onclick = function () { run(2); };
  document.getElementById("minify").onclick = function () { run(0); };
  document.getElementById("copy").onclick = function () {
    if (!output.value) return;
    navigator.clipboard.writeText(output.value).then(function () {
      status.textContent = "Copied ✓";
      status.style.color = "var(--muted)";
    });
  };
