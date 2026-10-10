import { createServer, type Server } from 'node:http';

/** GET /health and GET /metrics as JSON (bigints as strings). The app's /demo panel reads /health. */
export function startServer(
  port: number,
  routes: { health: () => Promise<unknown>; metrics: () => Promise<unknown> },
): Promise<Server> {
  const server = createServer((req, res) => {
    const route =
      req.url === '/health' ? routes.health : req.url === '/metrics' ? routes.metrics : null;
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
    if (req.method !== 'GET' || !route) {
      res.writeHead(404, headers).end(JSON.stringify({ error: 'not found' }));
      return;
    }
    route()
      .then((body) =>
        res
          .writeHead(200, headers)
          .end(
            JSON.stringify(body, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
          ),
      )
      .catch((err: unknown) =>
        res.writeHead(500, headers).end(JSON.stringify({ error: String(err) })),
      );
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
