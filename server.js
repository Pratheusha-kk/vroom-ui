const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { beginRequest, getMetricsSnapshot, getPrometheusMetrics } = require("./metrics");

const PORT = Number.parseInt(process.env.PORT || "5173", 10);
const GATEWAY_URL = process.env.VROOM_GATEWAY_URL || "http://localhost:8080";
const GATEWAY_PUBLIC_URL = process.env.VROOM_GATEWAY_PUBLIC_URL || "";
const publicDir = path.join(__dirname, "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function send(res, status, contentType, body) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function proxyToGateway(req, res, targetPath) {
  const target = new URL(targetPath, GATEWAY_URL);

  const proxyReq = http.request(target, {
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host
    }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    send(res, 502, "application/json; charset=utf-8", JSON.stringify({ error: "Gateway unavailable" }));
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://ui.local");
  const completeRequest = beginRequest(req.method, url.pathname);
  res.on("finish", () => completeRequest(res.statusCode));

  if (url.pathname.startsWith("/api/")) {
    proxyToGateway(req, res, `${url.pathname}${url.search}`);
    return;
  }

  if (url.pathname === "/gateway-health") {
    proxyToGateway(req, res, "/health");
    return;
  }

  if (url.pathname === "/health") {
    send(res, 200, "application/json; charset=utf-8", JSON.stringify({ status: "UP", service: "vroom-ui" }));
    return;
  }

  if (url.pathname === "/metrics") {
    send(res, 200, "application/json; charset=utf-8", JSON.stringify(getMetricsSnapshot()));
    return;
  }

  if (url.pathname === "/metrics/prometheus") {
    send(res, 200, "text/plain; version=0.0.4; charset=utf-8", getPrometheusMetrics());
    return;
  }

  if (req.url === "/config.js") {
    send(res, 200, contentTypes[".js"], `window.VROOM_CONFIG = ${JSON.stringify({ gatewayUrl: GATEWAY_PUBLIC_URL })};`);
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "text/plain; charset=utf-8", "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "text/plain; charset=utf-8", "Not found");
      return;
    }

    send(res, 200, contentTypes[path.extname(filePath)] || "application/octet-stream", data);
  });
});

server.listen(PORT, () => {
  console.log(`vroom-ui listening on port ${PORT}`);
});
