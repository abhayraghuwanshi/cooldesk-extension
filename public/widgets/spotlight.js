  // Mini spotlight. Live in CoolDesk via the bridge (spotlight.query);
  // on the site it searches a canned demo index so people can feel it.
  var DEMO = [
    ["📄", "Acme redesign — Figma", "tab"], ["📄", "PR #214 — payment retries", "tab"],
    ["📄", "Q3 planning doc", "tab"], ["🖥️", "VS Code", "app"], ["🖥️", "Slack", "app"],
    ["🖥️", "Spotify", "app"], ["📝", "Meeting notes — Tuesday", "note"], ["📝", "Ideas backlog", "note"],
    ["🗂️", "Client — Acme", "workspace"], ["🗂️", "Side Project", "workspace"],
    ["🔖", "Tailwind cheatsheet", "bookmark"], ["🕘", "How to name things — blog", "history"]
  ];
  var q = document.getElementById("q"), hits = document.getElementById("hits");
  function render(list) {
    hits.innerHTML = "";
    list.slice(0, 6).forEach(function (h, i) {
      var el = document.createElement("div");
      el.className = "hit" + (i === 0 ? " sel" : "");
      el.innerHTML = "<span>" + h[0] + '</span><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        h[1] + '</span><span class="kind">' + h[2] + "</span>";
      hits.appendChild(el);
    });
  }
  function search() {
    var term = q.value.trim().toLowerCase();
    if (cooldesk.hosted) {
      cooldesk.call("spotlight.query", { q: term }).then(render).catch(function () {});
      return;
    }
    render(!term ? DEMO : DEMO.filter(function (h) {
      return (h[1] + " " + h[2]).toLowerCase().indexOf(term) !== -1;
    }));
  }
  q.oninput = search;
  cooldesk.onHost = function () {
    document.getElementById("hint").textContent = "Live · searching your machine";
    search();
  };
  search();
