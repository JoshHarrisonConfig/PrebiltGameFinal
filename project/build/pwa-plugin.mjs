// Vite plugin: after every production build, writes dist/sw.js from build/sw-template.js,
// filling in the list of files to precache and a build id.
//
// The build id is a hash of every precached file's name and contents, so the worker's own
// bytes change whenever (and only when) the app changes. That is what makes browsers
// notice a new version and update.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Not part of the app shell: the worker itself, source maps, install-dialog screenshots
// (only fetched by the browser's install UI) and a leftover Vite template icon.
const NOT_PRECACHED = [/^sw\.js$/, /\.map$/, /^screenshots\//, /^vite\.svg$/];

// All files under `dir` as sorted, forward-slash paths relative to it.
export function collectFiles(dir, prefix = '') {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...collectFiles(join(dir, entry.name), relative));
    else found.push(relative);
  }
  return found.sort();
}

export function shellFiles(files) {
  return files.filter((file) => !NOT_PRECACHED.some((pattern) => pattern.test(file)));
}

// File path -> URL the page will request. index.html is requested as "/".
export function precacheUrls(files) {
  return shellFiles(files).map((file) => (file === 'index.html' ? '/' : `/${file}`));
}

export function computeBuildId(files, readFile) {
  const hash = createHash('sha256');
  // Sorted here, so the id never depends on the order a caller happens to list files in.
  for (const file of [...shellFiles(files)].sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

export function renderServiceWorker(template, { buildId, urls }) {
  const placeholders = ["'__BUILD_ID__'", '__PRECACHE_URLS__'];
  for (const placeholder of placeholders) {
    if (!template.includes(placeholder)) throw new Error(`Service worker template is missing ${placeholder}`);
  }
  // Replacer functions, so characters like "$" in a file name are never read as patterns.
  return template
    .replace("'__BUILD_ID__'", () => JSON.stringify(buildId))
    .replace('__PRECACHE_URLS__', () => JSON.stringify(urls, null, 2));
}

export function pwaPlugin({ template = 'build/sw-template.js' } = {}) {
  let config;
  return {
    name: 'prebilt-pwa',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle() {
      if (config.build.ssr) return;
      const outDir = resolve(config.root, config.build.outDir);
      const files = collectFiles(outDir);
      const buildId = computeBuildId(files, (file) => readFileSync(join(outDir, file)));
      const source = readFileSync(resolve(config.root, template), 'utf8');
      const urls = precacheUrls(files);
      writeFileSync(join(outDir, 'sw.js'), renderServiceWorker(source, { buildId, urls }));
      config.logger.info(`PWA: wrote sw.js (${urls.length} files precached, build ${buildId})`);
    }
  };
}
