// Local preview of the whole site, API and back office, with an embedded Postgres (PGlite).
// Usage: ADMIN_PASSWORD="choose-a-local-password" npm run dev   then open http://localhost:8888
// Local data lives in .netlify/db and never touches the live site.
import { createServer } from "node:http";
import { NetlifyDev } from "@netlify/dev";

const port = Number(process.env.PORT || 8888);
const dev = new NetlifyDev({
  projectRoot: process.cwd(),
  database: { enabled: true },
  blobs: { enabled: false },
  edgeFunctions: { enabled: false },
  aiGateway: { enabled: false },
  environmentVariables: { enabled: true },
  functions: { enabled: true },
  redirects: { enabled: true },
  staticFiles: { enabled: true },
});
await dev.start();

if (dev.db) await dev.db.applyMigrations("netlify/database/migrations");
else console.warn("Local database did not start; the back office API will not work.");

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: Object.entries(req.headers).filter(([, v]) => typeof v === "string"),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
  const headers = {};
  const response = await dev.handle(request, { headersCollector: (k, v) => { headers[k] = v; } });
  if (!response) { res.writeHead(404); res.end("Not found"); return; }
  const out = {};
  response.headers.forEach((v, k) => { out[k] = v; });
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) out["set-cookie"] = cookies;
  res.writeHead(response.status, { ...headers, ...out });
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`Zenith running at http://localhost:${port}`));
