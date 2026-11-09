const net = require('net');                    // TCP connections (built in), used to connect to the SSH server
const path = require('path');                  // builds file paths that work on any operating system
const http = require('http');                  // HTTP server (built in); the WebSocket server runs on top of it
const express = require('express');            // serves the browser files from the public folder
const { WebSocketServer } = require('ws');     // the open channel between the browser and this server
const { Client } = require('ssh2');            // SSH client that connects to the target server

// Only pages served by this app may open a WebSocket to it.
const ALLOWED_ORIGINS = ['http://localhost:3000'];

// SSH servers the app may connect to. Override with ALLOWED_HOSTS=host1,host2
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1').split(',');

const app = express();
const server = http.createServer(app);

// The WebSocket server shares the HTTP server, so both run on the same port.
const wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024, // keystrokes are tiny, so larger messages are rejected
  verifyClient: (info) => ALLOWED_ORIGINS.includes(info.origin), // blocks other websites
});

// Serve only the files in the public folder to the browser.
app.use(express.static(path.join(__dirname, 'public')));

// Runs once per browser tab. Each tab gets its own SSH connection and shell.
wss.on('connection', (ws) => {
  console.log('Browser connected');

  const conn = new Client();
  let sock = null;     // TCP socket to the SSH server, read for monitoring
  let stream = null;   // the interactive shell, set once SSH is ready
  let started = false; // each browser connection may log in to SSH only once

  let metricsTimer = null;
  let lastIn = 0;
  let lastOut = 0;

  // All messages are objects with a "type" field that says what they are.
  const sendJson = (message) => {
    ws.send(JSON.stringify(message));
  };

  // Every second, send the socket state and byte counters to the browser.
  // The counters only grow, so the rate is the difference from the previous sample.
  const startMetrics = () => {
    metricsTimer = setInterval(() => {
      const bytesIn = sock.bytesRead;
      const bytesOut = sock.bytesWritten;

      sendJson({
        type: 'metrics',
        state: sock.readyState,
        remote: sock.remoteAddress,
        bytesIn,
        bytesOut,
        rateIn: bytesIn - lastIn,
        rateOut: bytesOut - lastOut,
      });

      lastIn = bytesIn;
      lastOut = bytesOut;
    }, 1000);
  };

  const stopMetrics = () => {
    clearInterval(metricsTimer);
  };

  // SSH login succeeded: open a shell that stays open for many commands.
  conn.on('ready', () => {
    conn.shell((err, shell) => {
      if (err) {
        sendJson({ type: 'error', message: err.message || 'Could not open shell' });
        conn.end();
        return;
      }

      stream = shell;
      // Decode as UTF-8 here, so a character split between two chunks is not garbled.
      shell.setEncoding('utf8');
      sendJson({ type: 'status', state: 'connected' });

      // Shell output goes straight to the browser terminal.
      shell.on('data', (data) => {
        sendJson({ type: 'output', data });
      });

      // The shell ended, for example after the user typed exit.
      shell.on('close', () => {
        conn.end();
      });
    });
  });

  // Some errors have no message (e.g. connection refused on both IPv4 and IPv6),
  // so fall back to the error code.
  conn.on('error', (err) => {
    sendJson({ type: 'error', message: err.message || err.code || 'Connection failed' });
  });

  // SSH closed for any reason: stop monitoring and close the browser connection.
  conn.on('close', () => {
    stopMetrics();
    ws.close();
  });

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // ignore messages that are not valid JSON
    }

    if (message.type === 'connect' && !started) {
      started = true;

      // Validate on the server even though the form checks too: a client can send anything.
      const port = Number(message.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        sendJson({ type: 'error', message: 'invalid port' });
        ws.close();
        return;
      }

      // Without this check, the app could be used to reach any server on the network.
      if (!ALLOWED_HOSTS.includes(message.host)) {
        sendJson({ type: 'error', message: 'host not allowed' });
        ws.close();
        return;
      }

      // ssh2 throws, and would crash the server, if these are not strings.
      if (typeof message.username !== 'string' || typeof message.password !== 'string') {
        sendJson({ type: 'error', message: 'invalid credentials' });
        ws.close();
        return;
      }

      // Open the TCP socket ourselves and hand it to ssh2, so its counters can be read.
      sock = net.connect(port, message.host);
      startMetrics();

      // The password is only passed to ssh2. It is never stored or logged.
      conn.connect({
        sock,
        username: message.username,
        password: message.password,
      });
    }

    // Keystrokes from the browser are written to the shell as-is.
    if (message.type === 'input' && stream && typeof message.data === 'string') {
      stream.write(message.data);
    }
  });

  // Browser tab closed: end the SSH session so it is not left open on the server.
  ws.on('close', () => {
    console.log('Browser disconnected');
    stopMetrics();
    conn.end();
  });
});

// Listen on localhost only, because the app has no login of its own.
server.listen(3000, '127.0.0.1', () => {
  console.log('Server running at http://localhost:3000');
});
