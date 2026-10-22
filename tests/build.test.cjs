const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

test('standalone inline scripts and styles match CSP after browser newline normalization', () => {
  const html = fs.readFileSync(path.join(__dirname, '../dist/Контекст1С.html'), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1];
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 4);
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  assert.equal(styles.length, 1);
  ['engine.js', 'demo.js', 'zip.js', 'app.js', 'styles.css'].forEach((name, i) => {
    const source = fs.readFileSync(path.join(__dirname, '../dist', name), 'utf8').replace(/\r\n?/g, '\n');
    const embedded = [...scripts, ...styles][i][1].replace(/\r\n?/g, '\n');
    assert.equal(embedded, source, `Standalone must contain the current ${name}`);
  });
  for (const [i, item] of [...scripts, ...styles].entries()) {
    // The HTML parser normalizes CRLF/CR before CSP checks the inline text.
    const browserText = item[1].replace(/\r\n?/g, '\n');
    const hash = crypto.createHash('sha256').update(browserText).digest('base64');
    assert.ok(policy.includes("'sha256-" + hash + "'"), `Inline block ${i}: CSP hash must match what the browser sees`);
    if (i < scripts.length) assert.doesNotThrow(() => new vm.Script(browserText));
  }
  assert.ok(policy.includes("connect-src 'none'"));
});
