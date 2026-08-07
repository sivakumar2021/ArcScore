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

function waitForHealth(url, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body });
        });
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

test('server starts without DATABASE_URL by using a dev fallback pool', async () => {
  const port = await getFreePort();
  const env = { ...process.env, DATABASE_URL: '', PORT: String(port) };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  try {
    const response = await waitForHealth(`http://127.0.0.1:${port}/health`);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /healthy/i);
  } finally {
    child.kill('SIGTERM');
  }

  assert.match(output, /fallback/i);
});
