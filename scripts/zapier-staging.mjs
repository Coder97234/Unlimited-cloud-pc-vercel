import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';

// Explicit static allowlist: do not package the app, API handlers, or env files.
const root = new URL('../staging/zapier/', import.meta.url);
const files = new Map();
for (const path of ['vercel.json', 'public/index.html', 'public/stage.css', 'public/stage.js', 'public/robots.txt']) {
  files.set(path, await readFile(new URL(path, root)));
}
files.set('public/orbit.svg', await readFile(new URL('../public/brand/xyvora-orbit.svg', import.meta.url)));

const [command, target] = process.argv.slice(2);
if (command === '--files') {
  console.log(JSON.stringify([...files].map(([file, data]) => ({ file, encoding: 'base64', data: data.toString('base64') }))));
} else if (command === '--export') {
  if (!target) throw new Error('Provide a new directory for the static deployment.');
  const destination = resolve(target);
  await mkdir(destination); // Fail if the destination already exists, so no prior files are included.
  for (const [file, data] of files) {
    const path = join(destination, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }
  console.log(`Exported ${files.size} staging files to ${destination}`);
} else {
  const port = Number(command ?? 4194);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use an unprivileged TCP port.');
  const config = JSON.parse(files.get('vercel.json'));
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key,
    // Local previews are rendered in Arena's iframe. Only the hosted project forbids framing.
    key === 'Content-Security-Policy' ? value.replace(" frame-ancestors 'none';", '') : value]));
  const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', txt: 'text/plain' };
  createServer((req, res) => {
    const path = req.url?.split('?')[0];
    const file = path === '/' ? 'public/index.html' : `public${path}`;
    const data = files.get(file);
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
    } else if (!data) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    } else {
      res.writeHead(200, { ...headers, 'Content-Type': `${types[file.split('.').at(-1)]}; charset=utf-8` }).end(req.method === 'HEAD' ? undefined : data);
    }
  }).listen(port, '0.0.0.0', () => console.log(`Zapier staging preview is listening on port ${port}.`));
}
