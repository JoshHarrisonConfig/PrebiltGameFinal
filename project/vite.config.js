import { defineConfig, loadEnv } from 'vite';
import { localApiPlugin } from './server/dev-plugin.mjs';
import { pwaPlugin } from './build/pwa-plugin.mjs';

export default defineConfig(({ mode }) => {
  // Empty prefix: also load server-only settings such as ADMIN_PASSWORD from .env.local.
  // These are read by the dev API only and are never exposed to the browser bundle.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      // `npm run dev` / `npm run preview`: serves the same /api/* as production, from a local file.
      localApiPlugin({ env, dataFile: env.DEV_DATA_FILE || undefined }),
      // `npm run build`: writes the offline service worker (dist/sw.js).
      pwaPlugin()
    ]
  };
});
