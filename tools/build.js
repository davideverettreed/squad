// Build: inline the stylesheet and scripts into single-file pages.
//   dist/index.html    standalone page (open directly, host anywhere, wrap for Android)
//   dist/artifact.html body-only page for publishing as a claude.ai Artifact
'use strict';
const fs = require('fs');
const path = require('path');

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
console.log('Built dist/index.html and dist/artifact.html from ' + scripts.length + ' scripts, ' +
  Math.round(html.length / 1024) + ' KB.');
