// A local Netlify Blobs server for tests, built on the SDK's own BlobsServer.
//
// The SDK's local server is a development convenience and differs from the production
// service in two ways that matter to a compare-and-swap client:
//   1. it does not send the ETag header when an entry is read, and
//   2. it checks "If-Match" / "If-None-Match" and then writes in separate async steps,
//      so two concurrent writers can both pass the check.
// The production service documents ETags on reads and conditional writes that succeed
// only on a match, so this helper patches those two behaviours (and uses content-hash
// ETags, which cannot collide the way modification-time ETags can). Everything else -
// URL layout, headers, the real SDK client - is the genuine article.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobsServer } from '@netlify/blobs/server';

let patched = false;

function patchServerOnce() {
  if (patched) return;
  patched = true;

  BlobsServer.generateETag = async (filePath) => {
    try {
      const contents = await readFile(filePath);
      return `"${createHash('sha256').update(contents).digest('hex')}"`;
    } catch {
      return '';
    }
  };

  // Reads and writes take turns. That makes "check the condition, then write" atomic, and
  // it makes a read return data and ETag from the same moment, as the real service does
  // (otherwise a write landing between the two reads would pair old data with a new ETag).
  let queue = Promise.resolve();
  const exclusively = (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  const originalGet = BlobsServer.prototype.get;
  BlobsServer.prototype.get = function get(request) {
    return exclusively(async () => {
      const response = await originalGet.call(this, request);
      if (response.status !== 200) return response;
      const { dataPath, key } = this.getLocalPaths(new URL(request.url ?? '', this.address));
      if (!key) return response; // a listing, not an entry
      const headers = new Headers(response.headers);
      headers.set('etag', await BlobsServer.generateETag(dataPath));
      return new Response(response.body, { status: 200, headers });
    });
  };

  const originalPut = BlobsServer.prototype.put;
  BlobsServer.prototype.put = function put(request) {
    return exclusively(() => originalPut.call(this, request));
  };
}

export async function startBlobsTestServer() {
  patchServerOnce();
  const token = 'local-test-token';
  const directory = await mkdtemp(join(tmpdir(), 'blobs-test-'));
  const server = new BlobsServer({ directory, token });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;

  return {
    clientOptions: { edgeURL: url, uncachedEdgeURL: url, token, siteID: 'site-test' },
    async stop() {
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  };
}
