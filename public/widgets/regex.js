  // Runs entirely locally.
  function esc(s) {
    return s.replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; });
  }
  function run() {
    var out = document.getElementById("out");
    var count = document.getElementById("count");
    var src = document.getElementById("text").value;
    var pat = document.getElementById("pattern").value;
    if (!pat) { out.innerHTML = esc(src); count.textContent = ""; return; }
    var re;
    try {
      var flags = document.getElementById("flags").value;
      re = new RegExp(pat, flags.indexOf("g") === -1 ? flags + "g" : flags);
    } catch (e) {
      out.textContent = String(e.message);
      count.textContent = "invalid";
      return;
    }
    var html = "", last = 0, m, n = 0;
    while ((m = re.exec(src)) !== null) {
      html += esc(src.slice(last, m.index)) + "<mark>" + esc(m[0] || "∅") + "</mark>";
      last = m.index + m[0].length;
      n++;
      if (m[0] === "") re.lastIndex++; // avoid infinite loop on empty matches
      if (n > 999) break;
    }
    html += esc(src.slice(last));
    out.innerHTML = html;
    count.textContent = n + (n === 1 ? " match" : " matches");
  }
  document.getElementById("pattern").oninput = run;
  document.getElementById("flags").oninput = run;
  document.getElementById("text").oninput = run;
  run();
