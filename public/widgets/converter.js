  // Factors are "units per base unit"; temperature handled specially.
  var UNITS = {
    Length: { m: 1, km: 0.001, cm: 100, mi: 0.000621371, ft: 3.28084, in: 39.3701 },
    Weight: { kg: 1, g: 1000, lb: 2.20462, oz: 35.274 },
    Data: { MB: 1, KB: 1024, GB: 1 / 1024, TB: 1 / (1024 * 1024) },
    Speed: { "km/h": 1, "mph": 0.621371, "m/s": 0.277778, "knots": 0.539957 },
    Temperature: { "°C": null, "°F": null, "K": null }
  };
  var cat = document.getElementById("cat"), from = document.getElementById("from"), to = document.getElementById("to");
  Object.keys(UNITS).forEach(function (c) { cat.add(new Option(c, c)); });

  function fillUnits() {
    from.innerHTML = ""; to.innerHTML = "";
    var keys = Object.keys(UNITS[cat.value]);
    keys.forEach(function (u) { from.add(new Option(u, u)); to.add(new Option(u, u)); });
    to.value = keys[1] || keys[0];
    compute();
  }
  function toC(v, u) { return u === "°C" ? v : u === "°F" ? (v - 32) * 5 / 9 : v - 273.15; }
  function fromC(v, u) { return u === "°C" ? v : u === "°F" ? v * 9 / 5 + 32 : v + 273.15; }
  function compute() {
    var v = parseFloat(document.getElementById("input").value);
    if (isNaN(v)) { document.getElementById("output").textContent = "—"; return; }
    var result;
    if (cat.value === "Temperature") result = fromC(toC(v, from.value), to.value);
    else result = v / UNITS[cat.value][from.value] * UNITS[cat.value][to.value];
    document.getElementById("output").textContent =
      result.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  cat.onchange = fillUnits;
  from.onchange = compute;
  to.onchange = compute;
  document.getElementById("input").oninput = compute;
  fillUnits();
