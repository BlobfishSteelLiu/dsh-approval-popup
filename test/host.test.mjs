import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, rmSync } from 'node:fs';

process.env.SystemRoot = 'Z:\\dsh-approval-popup-missing';
process.env.DSH_HOME = 'E:\\DSH\\_approval_test_home';
const { apply, name, inject } = await import('../lib/index.js');

assert.equal(name, 'dsh-approval-popup');
assert.deepEqual([...inject], ['webServer']);

function install(connection) {
  let route;
  const listeners = [];
  const ctx = {
    webServer: { register(value) { route = value; return () => {}; } },
    get(name) { return name === 'connection' ? connection : undefined; },
    effect(fn) { return fn(); },
    on(event, listener, options) { listeners.push({ event, listener, options }); return () => {}; }
  };
  apply(ctx);
  return { route, listeners };
}

const native = install();
assert.ok(native.route, 'bridge route registered');
assert.equal(native.route.path, '/dsh-approval-popup');
assert.equal(native.route.kind, 'prefix');
assert.equal(native.route.handler.length >= 2, true);
assert.deepEqual(
  native.listeners.map((listener) => listener.event),
  ['approval/request', 'tools/pre-execute', 'user-questions/request', 'session/event']
);
assert.equal(
  native.listeners.slice(0, 3).every((listener) => listener.options?.prepend === true),
  true
);

function call(route, url, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = url;
    req.socket = { remoteAddress: '127.0.0.1' };
    req.destroy = () => {};
    const res = {
      status: 0,
      value: undefined,
      writeHead(status) { this.status = status; },
      end(value) { this.value = JSON.parse(value); resolve(this); }
    };
    route.handler(req, res);
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
}

const settings = await call(native.route, '/dsh-approval-popup/settings/get', {});
assert.equal(settings.status, 200);
assert.equal(settings.value.ok, true);
assert.equal(settings.value.settings.enabled, true);
assert.equal(settings.value.settings.delete, true);
assert.equal(settings.value.settings.accent, 'deepBlue');
assert.equal(settings.value.settings.outside, 'notification');
assert.equal(settings.value.settings.questionNotify, true);

const denied = install({ requestRejection() { return 403; } });
const deniedResponse = await call(denied.route, '/dsh-approval-popup/settings/get', {});
assert.equal(deniedResponse.status, 403);

const unauthenticated = install({ requestRejection() { return 401; } });
const unauthenticatedResponse = await call(unauthenticated.route, '/dsh-approval-popup/settings/get', {});
assert.equal(unauthenticatedResponse.status, 401);

const testHome = 'E:\\DSH\\_approval_test_home';
const logPath = `${testHome}\\dsh-approval-popup\\approvals.log`;
rmSync(testHome, { recursive: true, force: true });

function approvalRequest(callId, toolName, command) {
  const session = {
    id: 'session-log-test',
    title: 'Log test',
    workspace: 'E:\\DSH',
    seq: 1,
    eventAt(seq) {
      if (seq !== 0) return undefined;
      return { type: 'tool/call', data: { callId, name: toolName, arguments: { command } } };
    }
  };
  return { callId, toolName, agent: { session }, reason: command };
}

const listener = native.listeners[0].listener;

const bashController = new AbortController();
const bashPending = listener({ ...approvalRequest('call-log-bash', 'bash', 'robocopy src dst /MIR'), signal: bashController.signal });
bashController.abort();
await bashPending;

const pwshController = new AbortController();
const pwshPending = listener({ ...approvalRequest('call-log-pwsh', 'pwsh', 'Write-Output test'), signal: pwshController.signal });
pwshController.abort();
await pwshPending;

const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
assert.equal(lines.length, 2);
assert.deepEqual(
  lines.map((line) => [line.sessionId, line.callId, line.tool, line.level]),
  [
    ['session-log-test', 'call-log-bash', 'bash', 'high-risk'],
    ['session-log-test', 'call-log-pwsh', 'pwsh', 'high-risk']
  ]
);
rmSync(testHome, { recursive: true, force: true });

console.log('host approval owner test passed');
