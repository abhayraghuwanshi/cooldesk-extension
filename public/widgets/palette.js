  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var f = function (n) {
      var k = (n + h / 30) % 12;
      var c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * c).toString(16).padStart(2, "0");
    };
    return "#" + f(0) + f(8) + f(4);
  }
  function generate() {
    var base = Math.floor(Math.random() * 360);
    var scheme = [
      [base, 68, 62], [(base + 25) % 360, 60, 72], [(base + 180) % 360, 55, 58],
      [(base + 205) % 360, 45, 42], [base, 30, 22]
    ];
    var box = document.getElementById("swatches");
    box.innerHTML = "";
    scheme.forEach(function (c) {
      var hex = hslToHex(c[0], c[1], c[2]);
      var el = document.createElement("div");
      el.className = "swatch";
      el.style.background = hex;
      el.innerHTML = "<span>" + hex + "</span>";
      el.onclick = function () {
        navigator.clipboard.writeText(hex).then(function () {
          document.getElementById("status").textContent = "Copied " + hex;
          setTimeout(function () {
            document.getElementById("status").textContent = "Palette — click a color to copy";
          }, 1400);
        });
      };
      box.appendChild(el);
    });
  }
  document.getElementById("gen").onclick = generate;
  generate();
