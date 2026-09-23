#!/usr/bin/env node
// Wraps typescript-language-server so it can find a workspace tsserver.js,
// including one that only exists inside a Yarn PnP SDK folder.
// Only the child's raw protocol bytes ever reach stdout; everything else goes to stderr.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const HEADER_SEPARATOR = '\r\n\r\n';

function log(message) {
  process.stderr.write(`tsls-workspace: ${message}\n`);
}

// Walks up from `startDir` looking for a Yarn PnP editor SDK's tsserver.js.
function findPnpTsserver(startDir) {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, '.yarn', 'sdks', 'typescript', 'lib', 'tsserver.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The TypeScript that ships next to the running node install, if any.
function globalFallbackTsserver() {
  const nodeRoot = path.dirname(path.dirname(process.execPath));
  const candidate = path.join(nodeRoot, 'lib', 'node_modules', 'typescript', 'lib', 'tsserver.js');
  return fs.existsSync(candidate) ? candidate : null;
}

// Best-effort conversion of a rootUri/rootPath/workspaceFolder value to a filesystem path.
function toFsPath(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.startsWith('file://')) {
    try {
      return fileURLToPath(value);
    } catch {
      return null;
    }
  }
  return value;
}

function deriveWorkspaceRoot(params) {
  const folderUri = params?.workspaceFolders?.[0]?.uri;
  const root = toFsPath(folderUri) ?? toFsPath(params?.rootUri) ?? toFsPath(params?.rootPath);
  return root ?? process.cwd();
}

// Mutates an `initialize` message in place so tsserver.path/fallbackPath are set when useful.
function patchInitializeMessage(message) {
  if (message?.method !== 'initialize') return message;
  const params = message.params ?? {};
  const workspaceRoot = deriveWorkspaceRoot(params);
  const initializationOptions = { ...(params.initializationOptions ?? {}) };
  const tsserver = { ...(initializationOptions.tsserver ?? {}) };

  if (!tsserver.path) {
    const pnpPath = findPnpTsserver(workspaceRoot);
    if (pnpPath) {
      tsserver.path = pnpPath;
      log(`resolved workspace tsserver via Yarn PnP: ${pnpPath}`);
    }
  }
  if (!tsserver.fallbackPath) {
    const fallback = globalFallbackTsserver();
    if (fallback) {
      tsserver.fallbackPath = fallback;
      log(`set tsserver fallbackPath: ${fallback}`);
    }
  }

  initializationOptions.tsserver = tsserver;
  params.initializationOptions = initializationOptions;
  message.params = params;
  return message;
}

function serializeMessage(message) {
  const json = JSON.stringify(message);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}${HEADER_SEPARATOR}`, 'ascii');
  return Buffer.concat([header, body]);
}

// Extracts one LSP frame from the front of `buffer`; null means the frame isn't complete yet.
function extractFirstFrame(buffer) {
  const headerEnd = buffer.indexOf(HEADER_SEPARATOR);
  if (headerEnd === -1) return null;
  const header = buffer.subarray(0, headerEnd).toString('ascii');
  const match = /Content-Length:\s*(\d+)/i.exec(header);
  if (!match) return { malformed: true, raw: buffer };
  const contentLength = Number.parseInt(match[1], 10);
  const bodyStart = headerEnd + HEADER_SEPARATOR.length;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) return null;
  return {
    raw: buffer.subarray(0, bodyEnd),
    body: buffer.subarray(bodyStart, bodyEnd),
    rest: buffer.subarray(bodyEnd),
  };
}

const child = spawn('typescript-language-server', ['--stdio'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

child.on('error', (error) => {
  log(`failed to spawn typescript-language-server: ${error.message}`);
  process.exit(1);
});

child.stdout.pipe(process.stdout);

let handshakeDone = false;
let buffered = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  if (handshakeDone) {
    child.stdin.write(chunk);
    return;
  }

  buffered = Buffer.concat([buffered, chunk]);
  const frame = extractFirstFrame(buffered);
  if (frame === null) return; // still waiting on the rest of the first frame

  handshakeDone = true;

  if (frame.malformed) {
    log('first frame had no parsable Content-Length header; forwarding unchanged');
    child.stdin.write(frame.raw);
    return;
  }

  let outgoing;
  try {
    const message = JSON.parse(frame.body.toString('utf8'));
    outgoing = serializeMessage(patchInitializeMessage(message));
  } catch (error) {
    log(`could not patch the first frame, forwarding unchanged: ${error.message}`);
    outgoing = frame.raw;
  }

  child.stdin.write(outgoing);
  if (frame.rest.length > 0) child.stdin.write(frame.rest);
});

process.stdin.on('end', () => {
  child.stdin.end();
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
