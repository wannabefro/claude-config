#!/usr/bin/env node
// Spawns the wrapper, drives a real LSP handshake, and checks PnP tsserver resolution.
// Exits 0 only if every case passes; prints one PASS/FAIL line per case.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WRAPPER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tsls-workspace.mjs');
const CASE_TIMEOUT_MS = 120_000;
const HEADER_SEPARATOR = '\r\n\r\n';

// Minimal LSP client: frames requests/notifications and resolves pending requests by id.
class LspClient {
  constructor(child) {
    this.child = child;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.spawnError = null;
    child.on('error', (error) => {
      this.spawnError = error;
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    });
    child.stdout.on('data', (chunk) => this._onData(chunk));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + HEADER_SEPARATOR.length);
        continue;
      }
      const length = Number.parseInt(match[1], 10);
      const bodyStart = headerEnd + HEADER_SEPARATOR.length;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.subarray(bodyEnd);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      this._dispatch(message);
    }
  }

  _dispatch(message) {
    if (message.id === undefined || message.id === null) return; // server notification/request, ignore
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else pending.resolve(message.result);
  }

  _send(message) {
    const json = JSON.stringify(message);
    const body = Buffer.from(json, 'utf8');
    const header = Buffer.from(`Content-Length: ${body.length}${HEADER_SEPARATOR}`, 'ascii');
    this.child.stdin.write(Buffer.concat([header, body]));
  }

  request(method, params) {
    if (this.spawnError) return Promise.reject(this.spawnError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params });
  }
}

function assertCapabilities(result) {
  if (!result || typeof result.capabilities !== 'object') {
    throw new Error(`expected initialize result with capabilities, got ${JSON.stringify(result)}`);
  }
}

// Best-effort cleanup; shutdown/exit quirks after a deliberately-failed initialize don't fail the case.
async function shutdownAndExit(client) {
  try {
    await client.request('shutdown', null);
  } catch {
    // ignore
  }
  try {
    client.notify('exit', null);
  } catch {
    // ignore
  }
}

async function caseFullRepo(client) {
  const rootUri = 'file:///Users/sam.mctaggart/Klaviyo/Repos/fender';
  const initResult = await client.request('initialize', { processId: process.pid, rootUri, capabilities: {} });
  assertCapabilities(initResult);
  client.notify('initialized', {});

  const filePath = '/Users/sam.mctaggart/Klaviyo/Repos/fender/client/shared/l10n/src/components/TranslateButton.tsx';
  const fileUri = `file://${filePath}`;
  const text = fs.readFileSync(filePath, 'utf8');
  client.notify('textDocument/didOpen', {
    textDocument: { uri: fileUri, languageId: 'typescriptreact', version: 1, text },
  });

  const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri: fileUri } });
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new Error(`expected a non-empty documentSymbol array, got ${JSON.stringify(symbols)}`);
  }

  await shutdownAndExit(client);
}

async function caseSubdirectory(client) {
  const rootUri = 'file:///Users/sam.mctaggart/Klaviyo/Repos/fender/client/shared/l10n';
  const initResult = await client.request('initialize', { processId: process.pid, rootUri, capabilities: {} });
  assertCapabilities(initResult);
  client.notify('initialized', {});
  await shutdownAndExit(client);
}

// Same formula the wrapper uses for tsserver.fallbackPath; decides which branch this case expects.
function globalFallbackCandidate() {
  const nodeRoot = path.dirname(path.dirname(process.execPath));
  return path.join(nodeRoot, 'lib', 'node_modules', 'typescript', 'lib', 'tsserver.js');
}

async function caseNoTypescript(client) {
  const rootUri = 'file:///Users/sam.mctaggart/.claude';
  const fallbackCandidate = globalFallbackCandidate();
  const fallbackAvailable = fs.existsSync(fallbackCandidate);

  let initResult;
  let initError;
  try {
    initResult = await client.request('initialize', { processId: process.pid, rootUri, capabilities: {} });
  } catch (error) {
    initError = error;
  }

  if (fallbackAvailable) {
    if (initError) throw new Error(`expected success via tsserver.fallbackPath, got: ${initError.message}`);
    assertCapabilities(initResult);
    client.notify('initialized', {});
  } else {
    console.log(`  no global fallback tsserver.js at ${fallbackCandidate}; asserting the documented failure`);
    if (!initError) {
      throw new Error('expected the documented "no valid TypeScript installation" failure, but initialize succeeded');
    }
    if (!/valid TypeScript installation/i.test(initError.message)) {
      throw new Error(`expected the documented TypeScript-not-found error, got: ${initError.message}`);
    }
  }

  await shutdownAndExit(client);
}

async function withCase(name, fn) {
  let child;
  const stderrChunks = [];
  try {
    await Promise.race([
      (async () => {
        child = spawn(process.execPath, [WRAPPER_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
        child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
        await fn(new LspClient(child));
      })(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`case timed out after ${CASE_TIMEOUT_MS}ms`)), CASE_TIMEOUT_MS);
      }),
    ]);
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
    if (stderrChunks.length > 0) {
      console.log(`  wrapper stderr: ${Buffer.concat(stderrChunks).toString('utf8').trim()}`);
    }
    return false;
  } finally {
    if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL');
  }
}

async function main() {
  const results = [
    await withCase('(a) full fender repo: PnP tsserver resolves and documentSymbol is non-empty', caseFullRepo),
    await withCase('(b) fender subdirectory: walk-up finds the PnP tsserver', caseSubdirectory),
    await withCase('(c) workspace with no TypeScript: fallbackPath behavior', caseNoTypescript),
  ];
  process.exit(results.every(Boolean) ? 0 : 1);
}

main();
