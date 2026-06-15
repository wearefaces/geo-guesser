#!/usr/bin/env node
/**
 * Tiny zero-dependency static file server for the GeoGuess game.
 * Avoids needing `npm install` (handy in restricted/offline environments).
 *
 *   npm start          # serves on http://localhost:5173
 *   PORT=8080 npm start
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5173;
// Bind to all interfaces so a preview proxy / other device on the network can
// reach it, not just loopback inside the container.
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  // Strip query string and normalize; default to index.html.
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // Resolve within ROOT and guard against path traversal.
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type }).end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🌍 GeoGuess running at http://${HOST}:${PORT} (open http://localhost:${PORT})`);
});
