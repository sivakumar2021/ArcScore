const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => {
        if (err) return reject(err);
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function waitForServer(url, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
      req.on('error', (err) => {
        if (Date.now() - start > timeoutMs) {
          reject(err);
          return;
        }
        setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

test('server picks another port when the requested port is occupied', async () => {
  const busyPort = await getFreePort();
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(busyPort, '127.0.0.1', resolve);
  });

  const env = { ...process.env, DATABASE_URL: '', PORT: String(busyPort) };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    const match = await new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const m = output.match(/port (\d+)/i);
        if (m) {
          clearInterval(timer);
          resolve(Number(m[1]));
        } else if (Date.now() - start > 8000) {
          clearInterval(timer);
          reject(new Error(output || 'server did not report a port'));
        }
      }, 100);
    });
    assert.ok(match > 0, 'expected server to report a listening port');
    assert.notEqual(match, 0, 'port should be non-zero');
    const response = await waitForServer(`http://127.0.0.1:${match}/health`);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /healthy/i);
  } finally {
    child.kill('SIGTERM');
    blocker.close();
  }
});
