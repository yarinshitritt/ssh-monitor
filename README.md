# SSH Monitor

Browser-based SSH terminal with real-time socket and traffic monitoring.

## Requirements

- Node.js
- An SSH server to connect to (for local testing, for example OpenSSH in WSL)

## Getting started

    npm install
    npm start

Open http://localhost:3000 and connect to an SSH server (default allowed hosts: localhost, 127.0.0.1).
To allow other hosts, set ALLOWED_HOSTS (comma-separated) before starting.

## Architecture

Browser (xterm.js) <-- WebSocket --> Node.js (ws, ssh2) <-- SSH/TCP --> Target server

Browsers cannot open raw TCP connections, so the Node.js server bridges the WebSocket and the SSH connection.
Each browser tab gets its own SSH connection and shell.

## Monitoring

The server opens the TCP socket to the SSH server itself and passes it to ssh2.
Every second it reads the socket state and byte counters and sends them to the browser.
The rate is the difference between two samples. The counters include SSH encryption overhead,
so they are higher than the amount of text shown in the terminal.

## Security

Implemented: allowed-host list, WebSocket origin check, message size limit, server-side input validation,
listening on localhost only, and the password is never stored or logged.
