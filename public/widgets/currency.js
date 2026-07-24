  // Rates: frankfurter.app (ECB data, no key). Last good rates cached for offline.
  var CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "AUD", "CAD", "CNY", "CHF", "SGD"];
  var from = document.getElementById("from"), to = document.getElementById("to");
  CURRENCIES.forEach(function (c) {
    from.add(new Option(c, c));
    to.add(new Option(c, c));
  });
  from.value = cooldesk.get("from", cooldesk.store.get("cur-from", "USD"));
  to.value = cooldesk.get("to", cooldesk.store.get("cur-to", "INR"));

  var rate = null;
  function compute() {
    var amount = parseFloat(document.getElementById("amount").value) || 0;
    document.getElementById("result").textContent =
      rate === null ? "—" : (amount * rate).toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  function load() {
    if (from.value === to.value) { rate = 1; compute(); document.getElementById("status").textContent = ""; return; }
    var key = "rate:" + from.value + ":" + to.value;
    fetch("https://api.frankfurter.app/latest?from=" + from.value + "&to=" + to.value)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        rate = d.rates[to.value];
        cooldesk.store.set(key, rate);
        document.getElementById("status").textContent = "1 " + from.value + " = " + rate + " " + to.value;
        compute();
      })
      .catch(function () {
        rate = cooldesk.store.get(key, null);
        document.getElementById("status").textContent = rate ? "Offline — cached rate" : "Offline";
        compute();
      });
  }
  function onSwap() {
    cooldesk.store.set("cur-from", from.value);
    cooldesk.store.set("cur-to", to.value);
    load();
  }
  from.onchange = onSwap;
  to.onchange = onSwap;
  document.getElementById("amount").oninput = compute;
  load();
