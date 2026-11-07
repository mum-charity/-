// Copy exactly the app's files into dist/ for the Cloudflare upload.
// The file list is the service worker's ASSETS list, so the two never drift apart.
// ASSETS lists the page as './', so index.html is added here, along with sw.js itself.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const list = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!list) throw new Error('ASSETS list not found in sw.js');
const files = [...list[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
files.push('index.html', 'sw.js');

fs.rmSync(dist, { recursive: true, force: true });
for (const f of files) {
  const from = path.join(root, f);
  if (!fs.existsSync(from)) throw new Error('Missing app file: ' + f);
  fs.mkdirSync(path.dirname(path.join(dist, f)), { recursive: true });
  fs.copyFileSync(from, path.join(dist, f));
}
console.log(`dist/ ready: ${files.length} files`);
