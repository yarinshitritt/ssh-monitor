const status = document.getElementById("status");
const termdiv = document.getElementById("terminal");
const form = document.getElementById("login-form");
const fhost = document.getElementById("host");
const fport = document.getElementById("port");
const fuser = document.getElementById("username");
const fpass = document.getElementById("password");

const term = new Terminal();
term.open(termdiv);

let ws = null;
let lastError = null; // kept so the close handler does not hide an error message

// Turns a byte count into readable text.
const formatBytes = (bytes) => {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
};

form.addEventListener("submit", (event) => {
  event.preventDefault(); // handle the form here instead of reloading the page
  lastError = null;
  term.reset(); // clear output from the previous session
  status.textContent = "connecting...";

  ws = new WebSocket(`ws://${location.host}`);

  // The first message carries the login details, and the server opens SSH with them.
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "connect",
      host: fhost.value,
      port: fport.value,
      username: fuser.value,
      password: fpass.value,
    }));
    fpass.value = ""; // do not keep the password on the page
  };

  // Every server message has a type that decides what to do with it.
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "status") {
      status.textContent = "connected";
      form.hidden = true;
    }

    // Displays the shell output; xterm.js interprets its control codes (colors, cursor moves).
    if (message.type === "output") {
      term.write(message.data);
    }

    if (message.type === "error") {
      lastError = message.message;
      status.textContent = lastError;
    }

    if (message.type === "metrics") {
      document.getElementById("m-state").textContent = message.state;
      document.getElementById("m-remote").textContent = message.remote;
      document.getElementById("m-in").textContent = formatBytes(message.bytesIn);
      document.getElementById("m-out").textContent = formatBytes(message.bytesOut);
      document.getElementById("m-rate-in").textContent = formatBytes(message.rateIn) + "/s";
      document.getElementById("m-rate-out").textContent = formatBytes(message.rateOut) + "/s";
    }
  };

  // After closing, the server stops sending metrics, so reset what would stay stale.
  ws.onclose = () => {
    status.textContent = lastError || "disconnected";
    form.hidden = false;
    document.getElementById("m-state").textContent = "closed";
    document.getElementById("m-rate-in").textContent = "0 B/s";
    document.getElementById("m-rate-out").textContent = "0 B/s";
  };
});

// Every keystroke is sent to the shell as-is; the echo comes back from the server.
term.onData((keys) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "input", data: keys }));
  }
});
