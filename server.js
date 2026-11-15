#!/usr/bin/env node
/**
 * Local host for the PC-Free site.
 *
 *   node server.js            # http://localhost:3000
 *   PORT=8080 node server.js
 *
 * Zero dependencies. It does three things:
 *   1. serves the static pages (with clean URLs: /docs -> docs.html)
 *   2. answers /api/vm-config from env (VM_DESKTOP_URL, VM_BOOT_URL, VM_LABEL)
 *   3. reverse-proxies /vm/* to the Windows machine, stripping the framing
 *      headers noVNC sends, so the desktop embeds even on plain http
 */
const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

// ---- tiny .env loader ------------------------------------------------------
(function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
})();

const VM_URL_RAW = (process.env.VM_DESKTOP_URL || "").trim();
const VM_LABEL = (process.env.VM_LABEL || "Windows 10").trim();
const VM_BOOT = (process.env.VM_BOOT_URL || "").trim();
let vmTarget = null;
if (VM_URL_RAW) {
  try {
    vmTarget = new URL(VM_URL_RAW);
  } catch {
    console.warn(`[warn] VM_DESKTOP_URL is not a valid URL: ${VM_URL_RAW}`);
  }
}

// ---- static files ---------------------------------------------------------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

function send404(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 Not found");
}

function resolveStatic(pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith("/")) p += "index.html";
  let abs = path.join(ROOT, path.normalize(p));
  if (!abs.startsWith(ROOT)) return null; // path traversal
  const candidates = [abs];
  if (!path.extname(abs)) candidates.push(abs + ".html");
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) return { file: c, size: st.size };
    } catch {}
  }
  return null;
}

function serveFile(req, res, hit) {
  const ext = path.extname(hit.file).toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  const isMedia = [".mp4", ".png", ".jpg", ".jpeg", ".webp"].includes(ext);
  const headers = {
    "Content-Type": type,
    "Cache-Control": isMedia ? "public, max-age=31536000" : "no-cache",
    "Accept-Ranges": "bytes",
  };
  if (hit.file.endsWith("pc.html")) headers["X-Robots-Tag"] = "noindex, nofollow";

  const range = req.headers.range;
  if (range && ext === ".mp4") {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : hit.size - 1;
      if (start >= hit.size || end >= hit.size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${hit.size}` });
        return res.end();
      }
      headers["Content-Range"] = `bytes ${start}-${end}/${hit.size}`;
      headers["Content-Length"] = end - start + 1;
      res.writeHead(206, headers);
      return fs.createReadStream(hit.file, { start, end }).pipe(res);
    }
  }
  headers["Content-Length"] = hit.size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(hit.file).pipe(res);
}

// ---- proxy to the Windows machine ----------------------------------------
function stripFraming(headers) {
  const out = { ...headers };
  delete out["x-frame-options"];
  delete out["content-security-policy"];
  delete out["content-security-policy-report-only"];
  delete out["content-length"]; // let Node recalculate after any rewrite
  return out;
}

function proxyHttp(req, res, target) {
  const basePath = target.pathname.replace(/\/$/, "");
  const sub = req.url.replace(/^\/vm/, "") || "/";
  const opts = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    method: req.method,
    path: basePath + sub,
    headers: { ...req.headers, host: target.host },
  };
  delete opts.headers["accept-encoding"]; // keep bodies text-rewritable

  const lib = target.protocol === "https:" ? https : http;
  const up = lib.request(opts, (upRes) => {
    const headers = stripFraming(upRes.headers);
    // keep redirects pointing back through the proxy
    if (headers.location && vmTarget) {
      headers.location = headers.location
        .replace(vmTarget.origin, "/vm")
        .replace(/^https?:\/\/[^/]+/, "/vm");
    }
    res.writeHead(upRes.statusCode || 502, headers);
    upRes.pipe(res);
  });
  up.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Cannot reach the Windows machine at ${target.origin}\n\n${err.message}\n`);
  });
  req.pipe(up);
}

// websocket upgrade piped straight through (noVNC needs it)
function proxyUpgrade(req, socket, head, target) {
  const basePath = target.pathname.replace(/\/$/, "");
  const sub = req.url.replace(/^\/vm/, "") || "/";
  const port = target.port || (target.protocol === "https:" ? 443 : 80);
  const onConnect = () => {
    const lines = [`${req.method} ${basePath + sub} HTTP/1.1`];
    for (const [k, v] of Object.entries(req.headers)) lines.push(`${k}: ${v}`);
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  };
  const upstream =
    target.protocol === "https:"
      ? tls.connect({ host: target.hostname, port, servername: target.hostname }, onConnect)
      : net.connect({ host: target.hostname, port }, onConnect);
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  upstream.setTimeout(0);
}

// ---- server ---------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/vm-config") {
    const configured = Boolean(vmTarget);
    const body = JSON.stringify({
      configured,
      // same-origin proxy path keeps the frame embeddable and avoids CORS
      desktopUrl: configured ? "/vm/" : null,
      directUrl: configured ? vmTarget.origin : null,
      bootUrl: VM_BOOT || null,
      label: VM_LABEL,
      embed: "iframe",
      notes: configured
        ? []
        : [
            "Set VM_DESKTOP_URL in .env (the port 8006 address of your dockurr/windows " +
              "container) and restart this server.",
          ],
    });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    return res.end(body);
  }

  if (url.pathname === "/vm" || url.pathname.startsWith("/vm/")) {
    if (!vmTarget) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("VM_DESKTOP_URL is not set — see .env.example\n");
    }
    return proxyHttp(req, res, vmTarget);
  }

  const hit = resolveStatic(url.pathname);
  if (!hit) return send404(res);
  serveFile(req, res, hit);
});

server.on("upgrade", (req, socket, head) => {
  if ((req.url === "/vm" || req.url.startsWith("/vm/")) && vmTarget) {
    return proxyUpgrade(req, socket, head, vmTarget);
  }
  socket.destroy();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PC-Free running on http://localhost:${PORT}`);
  console.log(`  site    http://localhost:${PORT}/`);
  console.log(`  my pc   http://localhost:${PORT}/pc`);
  console.log(
    `  machine ${vmTarget ? vmTarget.origin + "  (proxied at /vm/)" : "not configured — set VM_DESKTOP_URL in .env"}`
  );
});
