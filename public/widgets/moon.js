  // Computed locally from the synodic month — no network needed.
  var SYNODIC = 29.53058867;
  var KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // reference new moon
  var PHASES = [
    ["🌑", "New Moon"], ["🌒", "Waxing Crescent"], ["🌓", "First Quarter"], ["🌔", "Waxing Gibbous"],
    ["🌕", "Full Moon"], ["🌖", "Waning Gibbous"], ["🌗", "Last Quarter"], ["🌘", "Waning Crescent"]
  ];
  var age = ((Date.now() - KNOWN_NEW_MOON) / 86400000) % SYNODIC;
  var frac = age / SYNODIC;
  var idx = Math.round(frac * 8) % 8;
  var illumination = Math.round((1 - Math.cos(2 * Math.PI * frac)) / 2 * 100);
  var toFull = frac < 0.5 ? (0.5 - frac) * SYNODIC : (1.5 - frac) * SYNODIC;

  document.getElementById("icon").textContent = PHASES[idx][0];
  document.getElementById("name").textContent = PHASES[idx][1];
  document.getElementById("detail").textContent =
    illumination + "% lit · " + Math.round(toFull) + "d to full moon";
