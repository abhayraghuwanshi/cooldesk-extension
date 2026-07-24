  var QUOTES = [
    ["Simplicity is the ultimate sophistication.", "Leonardo da Vinci"],
    ["The way to get started is to quit talking and begin doing.", "Walt Disney"],
    ["Focus is a matter of deciding what things you're not going to do.", "John Carmack"],
    ["Amateurs sit and wait for inspiration; the rest of us just get up and go to work.", "Stephen King"],
    ["What we fear doing most is usually what we most need to do.", "Tim Ferriss"],
    ["It is not that we have a short time to live, but that we waste a lot of it.", "Seneca"],
    ["Make it work, make it right, make it fast.", "Kent Beck"],
    ["The best way to predict the future is to invent it.", "Alan Kay"],
    ["You do not rise to the level of your goals. You fall to the level of your systems.", "James Clear"],
    ["Deep work is the ability to focus without distraction on a cognitively demanding task.", "Cal Newport"],
    ["Whether you think you can, or you think you can't — you're right.", "Henry Ford"],
    ["Nothing is less productive than to make more efficient what should not be done at all.", "Peter Drucker"]
  ];
  var i = new Date().getDate() % QUOTES.length; // stable quote-of-the-day, click to shuffle
  function render() {
    document.getElementById("text").textContent = "“" + QUOTES[i][0] + "”";
    document.getElementById("author").textContent = "— " + QUOTES[i][1];
  }
  document.getElementById("box").onclick = function () {
    i = (i + 1 + Math.floor(Math.random() * (QUOTES.length - 1))) % QUOTES.length;
    render();
  };
  render();
