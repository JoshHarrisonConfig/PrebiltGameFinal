// Netlify Function entry point: serves everything under /api/*.
//
// Netlify Functions are stateless and several instances can run at once, so nothing is
// kept in memory here. All shared state lives in Netlify Blobs (see server/stores).

import { createApiHandler } from '../../server/api.mjs';
import { createBlobsStore, DEFAULT_STORE_NAME } from '../../server/stores/blobs-store.mjs';

export default async (request) => {
  const handler = createApiHandler({
    // Created per request: the Blobs client reads its credentials from the invocation
    // environment, which Netlify populates for each function call.
    store: createBlobsStore({ name: process.env.BLOBS_STORE_NAME || DEFAULT_STORE_NAME }),
    env: process.env
  });
  return handler(request);
};

export const config = {
  path: '/api/*'
};
