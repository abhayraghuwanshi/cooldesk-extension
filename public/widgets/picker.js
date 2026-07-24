  var result = document.getElementById("result");
  function reveal(final, pool) {
    // quick shuffle animation, then land on the answer
    var n = 0;
    var spin = setInterval(function () {
      result.textContent = pool[Math.floor(Math.random() * pool.length)];
      if (++n >= 8) { clearInterval(spin); result.textContent = final; }
    }, 70);
  }
  document.getElementById("form").onsubmit = function (e) {
    e.preventDefault();
    var opts = document.getElementById("options").value.split(",")
      .map(function (s) { return s.trim(); }).filter(Boolean);
    if (opts.length < 2) { result.textContent = "Give me at least two options"; return; }
    reveal(opts[Math.floor(Math.random() * opts.length)], opts);
  };
  document.getElementById("coin").onclick = function () {
    reveal(Math.random() < 0.5 ? "Heads" : "Tails", ["Heads", "Tails"]);
  };
  document.getElementById("dice").onclick = function () {
    var faces = ["1", "2", "3", "4", "5", "6"];
    reveal(faces[Math.floor(Math.random() * 6)], faces);
  };
