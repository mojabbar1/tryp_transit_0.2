/**
 * Preloaded (`NODE_OPTIONS=--require`) into the processes `npm run test:integration` starts. Test-only; plain CommonJS
 * so Node loads it before any app code.
 *
 * - INTEGRATION_BLOCK_NETWORK=1: every TCP/TLS connection to a non-loopback host fails before DNS or any packet, and
 *   a line starting with BLOCK_MARKER is written to stderr (the host only; never a path or query). The harness fails
 *   the run on that line, so no transit, LLM or TomTom request can leave the machine, whatever the inherited env.
 * - INTEGRATION_PARENT_PID: the direct child of that process exits when its stdin pipe from the harness closes, which
 *   happens however the harness ends (an error, a signal, even SIGKILL), so no server outlives its run. Descendants
 *   (their parent is another pid) and worker threads are left alone.
 */
'use strict';

const net = require('node:net');
const { isMainThread } = require('node:worker_threads');

const BLOCK_MARKER = '[integration-network-guard] blocked';
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3}|\[::1\])$/i;

function target(args) {
  const first = args[0];
  // net.connect() hands Socket#connect its normalized arguments as an array: [options, callback].
  const options = Array.isArray(first) ? first[0] : first;
  if (options && typeof options === 'object') return { host: options.host, path: options.path };
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { path: first };
  return { host: typeof args[1] === 'string' ? args[1] : undefined };
}

if (process.env.INTEGRATION_BLOCK_NETWORK === '1') {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const { host, path } = target(args);
    // A local pipe, or no host (Node then uses localhost), stays on the machine.
    if (path !== undefined || host === undefined || LOOPBACK.test(String(host))) return connect.apply(this, args);
    process.stderr.write(`${BLOCK_MARKER} ${String(host).slice(0, 255)}\n`);
    const error = Object.assign(new Error('Non-loopback connection blocked by the integration network guard'), { code: 'ECONNREFUSED' });
    process.nextTick(() => this.destroy(error));
    return this;
  };
}

// Worker threads share the pid and load this preload too, but their stdin is not the harness's pipe.
if (isMainThread && process.env.INTEGRATION_PARENT_PID && Number(process.env.INTEGRATION_PARENT_PID) === process.ppid) {
  const stop = () => {
    process.kill(process.pid, 'SIGTERM');
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.stdin.on('end', stop);
  process.stdin.on('error', stop);
  process.stdin.resume();
  // Watching the pipe must not keep a process alive that would otherwise exit (a build, say).
  if (typeof process.stdin.unref === 'function') process.stdin.unref();
}

module.exports = { BLOCK_MARKER, target };
