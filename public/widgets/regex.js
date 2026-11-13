  var T = cooldesk.t;
  // Runs entirely locally.
  function run() {
    var out = document.getElementById("out");
    var count = document.getElementById("count");
    var src = document.getElementById("text").value;
    var pat = document.getElementById("pattern").value;
    if (!pat) { out.textContent = src; count.textContent = ""; return; }
    var re;
    try {
      var flags = document.getElementById("flags").value;
      re = new RegExp(pat, flags.indexOf("g") === -1 ? flags + "g" : flags);
    } catch (e) {
      out.textContent = String(e.message);
      count.textContent = T("invalid");
      return;
    }
    // Plain text with the matches in <mark> — built as nodes, not HTML.
    var parts = [], last = 0, m, n = 0;
    while ((m = re.exec(src)) !== null) {
      parts.push(document.createTextNode(src.slice(last, m.index)));
      var mark = document.createElement("mark");
      mark.textContent = m[0] || "∅";
      parts.push(mark);
      last = m.index + m[0].length;
      n++;
      if (m[0] === "") re.lastIndex++; // avoid infinite loop on empty matches
      if (n > 999) break;
    }
    parts.push(document.createTextNode(src.slice(last)));
    out.replaceChildren.apply(out, parts);
    count.textContent = n === 1 ? T("1 match") : T("{n} matches", { n: n });
  }
  document.getElementById("pattern").oninput = run;
  document.getElementById("flags").oninput = run;
  document.getElementById("text").oninput = run;
  run();
