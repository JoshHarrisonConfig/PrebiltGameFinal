// Serves the same /api/* handler from the Vite dev server (`npm run dev`) and from
// `npm run preview`, backed by a local file, so the whole app can be tried locally
// without Netlify. State is shared by every browser/device that reaches this server.

import { createApiHandler } from './api.mjs';
import { createMemoryStore } from './stores/memory-store.mjs';

const MAX_BODY_BYTES = 1024 * 1024;

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function toWebRequest(req, body) {
  const origin = `http://${req.headers.host || 'localhost'}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && body.length > 0;
  return new Request(new URL(req.url, origin), {
    method: req.method,
    headers,
    body: hasBody ? body : undefined
  });
}

export function localApiPlugin({ env = {}, dataFile = '.data/dev-store.json' } = {}) {
  let handler = null;
  const getHandler = () => {
    handler ??= createApiHandler({ store: createMemoryStore({ file: dataFile }), env });
    return handler;
  };

  const middleware = async (req, res, next) => {
    if (!req.url || !/^\/api(\/|\?|$)/.test(req.url)) return next();
    try {
      const response = await getHandler()(toWebRequest(req, await readBody(req)));
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'dev_server_error', message: String(error?.message || error) }));
    }
  };

  return {
    name: 'prebilt-local-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    }
  };
}
