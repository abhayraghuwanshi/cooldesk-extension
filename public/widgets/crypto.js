  var T = cooldesk.t;
  // Prices: CoinGecko public API, no key. ?coins=bitcoin,ethereum,solana (CoinGecko ids)
  var ids = cooldesk.get("coins", "bitcoin,ethereum,solana").split(",");
  var SYMBOLS = { bitcoin: "BTC", ethereum: "ETH", solana: "SOL", dogecoin: "DOGE", cardano: "ADA", ripple: "XRP" };
  var rows = document.getElementById("rows");
  ids.forEach(function (id) {
    var el = document.createElement("div");
    el.className = "row spread";
    var sym = document.createElement("span");
    sym.style.cssText = "font-size:13px;font-weight:600";
    sym.textContent = SYMBOLS[id] || id.toUpperCase();
    var grow = document.createElement("span");
    grow.className = "grow";
    var chg = document.createElement("span");
    chg.className = "mono";
    chg.setAttribute("data-chg", "");
    chg.style.fontSize = "11px";
    var price = document.createElement("span");
    price.className = "big mono";
    price.setAttribute("data-price", "");
    price.style.fontSize = "16px";
    price.textContent = "—";
    el.append(sym, grow, chg, price);
    rows.appendChild(el);
  });
  function render(d, stale) {
    var priceEls = rows.querySelectorAll("[data-price]");
    var chgEls = rows.querySelectorAll("[data-chg]");
    ids.forEach(function (id, i) {
      var coin = d[id];
      if (!coin) return;
      priceEls[i].textContent = "$" + coin.usd.toLocaleString(cooldesk.locale, { maximumFractionDigits: coin.usd < 10 ? 4 : 0 });
      var chg = coin.usd_24h_change;
      chgEls[i].textContent = (chg >= 0 ? "+" : "") + chg.toFixed(1) + "%";
      chgEls[i].className = "mono " + (chg >= 0 ? "good" : "bad");
    });
    document.getElementById("status").textContent = stale ? "updating…" : "24h · USD";
  }

  // Paint the last quotes instantly (stale-while-revalidate), then refresh.
  var cacheKey = "crypto:" + ids.join(",");
  var last = cooldesk.store.get(cacheKey, null);
  if (last && last.data) render(last.data, true);

  function load() {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=" + ids.join(",") +
      "&vs_currencies=usd&include_24hr_change=true")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        render(d, false);
        cooldesk.store.set(cacheKey, { data: d, at: Date.now() });
      })
      .catch(function () {
        if (!last) document.getElementById("status").textContent = T("Offline");
      });
  }
  load();
  setInterval(load, 60000);
