const os = require("node:os");

const serviceName = process.env.SERVICE_NAME || "vroom-ui";

const metrics = {
  startedAt: new Date().toISOString(),
  totalRequestsStarted: 0,
  totalRequestsCompleted: 0,
  activeRequests: 0,
  totalResponseTimeMs: 0,
  maxResponseTimeMs: 0,
  lastResponseTimeMs: 0,
  statusCodes: {},
  routes: {}
};

function round(value) {
  return Number(Number(value || 0).toFixed(2));
}

function beginRequest(method, path) {
  if (path === "/metrics" || path === "/metrics/prometheus") return () => {};

  metrics.totalRequestsStarted += 1;
  metrics.activeRequests += 1;
  const route = `${method} ${path || "/"}`;
  const startedAt = process.hrtime.bigint();
  let completed = false;

  return (statusCode) => {
    if (completed) return;
    completed = true;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const routeMetrics = metrics.routes[route] || {
      count: 0,
      totalResponseTimeMs: 0,
      maxResponseTimeMs: 0,
      lastResponseTimeMs: 0,
      lastStatusCode: null,
      statusCodes: {}
    };

    metrics.activeRequests -= 1;
    metrics.totalRequestsCompleted += 1;
    metrics.totalResponseTimeMs += durationMs;
    metrics.maxResponseTimeMs = Math.max(metrics.maxResponseTimeMs, durationMs);
    metrics.lastResponseTimeMs = durationMs;
    metrics.statusCodes[statusCode] = (metrics.statusCodes[statusCode] || 0) + 1;

    routeMetrics.count += 1;
    routeMetrics.totalResponseTimeMs += durationMs;
    routeMetrics.maxResponseTimeMs = Math.max(routeMetrics.maxResponseTimeMs, durationMs);
    routeMetrics.lastResponseTimeMs = durationMs;
    routeMetrics.lastStatusCode = statusCode;
    routeMetrics.statusCodes[statusCode] = (routeMetrics.statusCodes[statusCode] || 0) + 1;
    metrics.routes[route] = routeMetrics;
  };
}

function cpuMetrics() {
  const usage = process.cpuUsage();
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length || 1;
  const totalMs = (usage.user + usage.system) / 1000;
  const possibleMs = process.uptime() * 1000 * cores;
  return {
    cores,
    user_ms: round(usage.user / 1000),
    system_ms: round(usage.system / 1000),
    total_ms: round(totalMs),
    utilization_percentage: round(possibleMs > 0 ? (totalMs / possibleMs) * 100 : 0),
    load_average: os.loadavg().map(round)
  };
}

function memoryMetrics() {
  const usage = process.memoryUsage();
  return {
    rss_bytes: usage.rss,
    heap_total_bytes: usage.heapTotal,
    heap_used_bytes: usage.heapUsed,
    external_bytes: usage.external,
    array_buffers_bytes: usage.arrayBuffers
  };
}

function routeMetrics() {
  return Object.fromEntries(Object.entries(metrics.routes).map(([route, item]) => [
    route,
    {
      count: item.count,
      average_response_time_ms: round(item.totalResponseTimeMs / item.count),
      max_response_time_ms: round(item.maxResponseTimeMs),
      last_response_time_ms: round(item.lastResponseTimeMs),
      last_status_code: item.lastStatusCode,
      status_codes: item.statusCodes
    }
  ]));
}

function getMetricsSnapshot() {
  const averageMs = metrics.totalRequestsCompleted > 0
    ? metrics.totalResponseTimeMs / metrics.totalRequestsCompleted
    : 0;
  return {
    health: {
      status: "ok",
      service: serviceName,
      started_at: metrics.startedAt,
      timestamp: new Date().toISOString()
    },
    uptime_seconds: round(process.uptime()),
    cpu: cpuMetrics(),
    memory: memoryMetrics(),
    response_time: {
      total_requests_started: metrics.totalRequestsStarted,
      total_requests_completed: metrics.totalRequestsCompleted,
      active_requests: metrics.activeRequests,
      average_response_time_ms: round(averageMs),
      max_response_time_ms: round(metrics.maxResponseTimeMs),
      last_response_time_ms: round(metrics.lastResponseTimeMs),
      status_codes: metrics.statusCodes,
      by_route: routeMetrics()
    }
  };
}

function escapeLabelValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n");
}

function line(name, value, labels = {}) {
  const entries = Object.entries(labels);
  const normalizedValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (entries.length === 0) return `${name} ${normalizedValue}`;
  return `${name}{${entries.map(([key, labelValue]) => `${key}="${escapeLabelValue(labelValue)}"`).join(",")}} ${normalizedValue}`;
}

function prefix() {
  return serviceName.replace(/[^a-zA-Z0-9]/g, "_");
}

function getPrometheusMetrics() {
  const snapshot = getMetricsSnapshot();
  const metricPrefix = prefix();
  const lines = [
    `# HELP ${metricPrefix}_up Service health status.`,
    `# TYPE ${metricPrefix}_up gauge`,
    line(`${metricPrefix}_up`, 1, { service: serviceName }),
    `# HELP ${metricPrefix}_uptime_seconds Process uptime in seconds.`,
    `# TYPE ${metricPrefix}_uptime_seconds gauge`,
    line(`${metricPrefix}_uptime_seconds`, snapshot.uptime_seconds, { service: serviceName }),
    `# HELP ${metricPrefix}_cpu_utilization_percentage Approximate CPU utilization percentage.`,
    `# TYPE ${metricPrefix}_cpu_utilization_percentage gauge`,
    line(`${metricPrefix}_cpu_utilization_percentage`, snapshot.cpu.utilization_percentage, { service: serviceName }),
    `# HELP ${metricPrefix}_cpu_time_ms_total Total process CPU time in milliseconds.`,
    `# TYPE ${metricPrefix}_cpu_time_ms_total counter`,
    line(`${metricPrefix}_cpu_time_ms_total`, snapshot.cpu.user_ms, { service: serviceName, mode: "user" }),
    line(`${metricPrefix}_cpu_time_ms_total`, snapshot.cpu.system_ms, { service: serviceName, mode: "system" }),
    `# HELP ${metricPrefix}_memory_bytes Process memory usage in bytes.`,
    `# TYPE ${metricPrefix}_memory_bytes gauge`,
    line(`${metricPrefix}_memory_bytes`, snapshot.memory.rss_bytes, { service: serviceName, area: "rss" }),
    line(`${metricPrefix}_memory_bytes`, snapshot.memory.heap_used_bytes, { service: serviceName, area: "heap_used" }),
    `# HELP ${metricPrefix}_requests_total Total completed HTTP requests.`,
    `# TYPE ${metricPrefix}_requests_total counter`,
    line(`${metricPrefix}_requests_total`, snapshot.response_time.total_requests_completed, { service: serviceName }),
    `# HELP ${metricPrefix}_active_requests Active HTTP requests.`,
    `# TYPE ${metricPrefix}_active_requests gauge`,
    line(`${metricPrefix}_active_requests`, snapshot.response_time.active_requests, { service: serviceName }),
    `# HELP ${metricPrefix}_response_time_ms HTTP response time in milliseconds.`,
    `# TYPE ${metricPrefix}_response_time_ms gauge`,
    line(`${metricPrefix}_response_time_ms`, snapshot.response_time.average_response_time_ms, {
      service: serviceName,
      aggregation: "average"
    })
  ];

  for (const [status, count] of Object.entries(snapshot.response_time.status_codes)) {
    lines.push(line(`${metricPrefix}_response_status_total`, count, { service: serviceName, status }));
  }

  for (const [route, item] of Object.entries(snapshot.response_time.by_route)) {
    lines.push(line(`${metricPrefix}_route_requests_total`, item.count, { service: serviceName, route }));
    lines.push(line(`${metricPrefix}_route_response_time_ms`, item.average_response_time_ms, {
      service: serviceName,
      route,
      aggregation: "average"
    }));
    for (const [status, count] of Object.entries(item.status_codes)) {
      lines.push(line(`${metricPrefix}_route_response_status_total`, count, { service: serviceName, route, status }));
    }
  }

  return `${lines.join("\n")}\n`;
}

module.exports = {
  beginRequest,
  getMetricsSnapshot,
  getPrometheusMetrics
};
