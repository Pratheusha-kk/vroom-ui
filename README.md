# vroom-ui

Simple browser UI for VROOM VROOM.

## Local Run

```bash
npm start
```

By default the UI proxies `/api/*` to `http://localhost:8080`. Override the gateway target with:

```bash
VROOM_GATEWAY_URL=http://localhost:8080 npm start
```

If you want browser requests to call a public gateway URL directly instead of using the UI proxy, set `VROOM_GATEWAY_PUBLIC_URL`.
