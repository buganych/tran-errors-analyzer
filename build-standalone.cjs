const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dist = path.join(__dirname, 'dist');
// HTML normalizes line endings before calculating CSP hashes. Hash that same text,
// including when the source checkout or an editor on Windows writes CRLF.
const readText = name => fs.readFileSync(path.join(dist, name), 'utf8').replace(/\r\n?/g, '\n');
let html = readText('index.html');
const css = readText('styles.css');
const scripts = ['engine.js', 'demo.js', 'zip.js', 'app.js'].map(readText);
const hash = text => "'sha256-" + crypto.createHash('sha256').update(text).digest('base64') + "'";
const policy = `default-src 'none'; script-src ${scripts.map(hash).join(' ')}; style-src ${hash(css)}; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/, (_, start, end) => start + policy + end);
html = html.replace('  <link rel="stylesheet" href="styles.css">', () => '<style>' + css + '</style>');
html = html.replace(/^  <script defer src="[^"]+"><\/script>\r?\n/gm, '');
html = html.replace('</body>', () => scripts.map(text => '<script>' + text + '</script>').join('\n') + '\n</body>');
fs.writeFileSync(path.join(dist, 'Контекст1С.html'), html);
console.log('Built: dist/Контекст1С.html');
