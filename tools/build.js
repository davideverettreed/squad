// Build: inline the stylesheet and scripts into single-file pages.
//   dist/index.html    standalone page (open directly, host anywhere, wrap for Android)
//   dist/artifact.html body-only page for publishing as a claude.ai Artifact
//   docs/              the website for GitHub Pages: the game as an installable app
//                      that works offline (manifest, service worker, icons)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="css\/style\.css">/, () => '<style>\n' + read('css/style.css') + '</style>');
const scripts = [];
html = html.replace(/<script src="(src\/[^"]+)"><\/script>\n?/g, (m, src) => { scripts.push(src); return ''; });
const js = scripts.map((s) => '// ---- ' + s + '\n' + read(s)).join('\n');
if (js.includes('</script')) throw new Error('A script contains </script>; it cannot be inlined.');
html = html.replace('</body>', '<script>\n' + js + '\n</script>\n</body>');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);

// Artifact pages get their own document skeleton, so keep only head content and body content.
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\n?/, '')
  .replace(/<meta name="viewport"[^>]*>\n?/, '');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
fs.writeFileSync(path.join(root, 'dist/artifact.html'), head.trim() + '\n' + body.trim() + '\n');

// Website. The page links the app manifest and registers the service worker; the
// worker's cache name carries a hash of the page so each release replaces the last.
const docs = path.join(root, 'docs');
fs.rmSync(docs, { recursive: true, force: true });
fs.mkdirSync(path.join(docs, 'icons'), { recursive: true });
const appHead = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">',
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="STEX">',
  '<meta name="description" content="Sand Table Exercise: Rifle Squad (STEX). Real-time squad tactics on a military map: command a 13-man Marine rifle squad.">',
].join('\n');
const register = "<script>\nif ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {\n" +
  "  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));\n}\n</script>\n";
const site = html.replace('</head>', appHead + '\n</head>').replace('</body>', register + '</body>');
fs.writeFileSync(path.join(docs, 'index.html'), site);
const version = crypto.createHash('sha256').update(site).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(docs, 'sw.js'), read('web/sw.js').replace('__VERSION__', version));
fs.copyFileSync(path.join(root, 'web/manifest.webmanifest'), path.join(docs, 'manifest.webmanifest'));
for (const f of fs.readdirSync(path.join(root, 'web/icons'))) fs.copyFileSync(path.join(root, 'web/icons', f), path.join(docs, 'icons', f));
fs.writeFileSync(path.join(docs, '.nojekyll'), '');

console.log('Built dist/index.html, dist/artifact.html and docs/ (site version ' + version + ') from ' +
  scripts.length + ' scripts, ' + Math.round(html.length / 1024) + ' KB.');
