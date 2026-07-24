  // Live in CoolDesk via the bridge (session.last / session.restore); demo on the site.
  var DEMO = {
    name: "Client — Acme", when: "Yesterday 18:42",
    tabs: 14, windows: 2, apps: ["VS Code", "Slack", "Figma"]
  };
  function render(s) {
    document.getElementById("name").textContent = s.name;
    document.getElementById("detail").textContent = s.when + " · " + s.tabs + " tabs · " + s.windows + " windows";
    document.getElementById("apps").textContent = s.apps.join(" · ");
  }
  document.getElementById("restore").onclick = function () {
    if (cooldesk.hosted) cooldesk.call("session.restore");
    else {
      this.textContent = "Works inside CoolDesk →";
      var btn = this;
      setTimeout(function () { btn.textContent = "Restore session"; }, 1600);
    }
  };
  cooldesk.onHost = function () {
    document.getElementById("mode").textContent = "Live";
    cooldesk.call("session.last").then(render).catch(function () { render(DEMO); });
  };
  render(DEMO);
