#!/usr/bin/env node
// ZaloDesk CLI: a client of the ZaloDesk MCP server (https://app.zalodesk.com/api/mcp).
// Sign-in is the server's OAuth (PKCE, loopback redirect); every command is one of its tools.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MCP = 'https://app.zalodesk.com/api/mcp';
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'zalodesk');
const FILE = join(DIR, 'auth.json');

const USAGE = `ZaloDesk from the terminal: your Zalo and Zalo OA inbox, team and routing.

  zalodesk login                      Sign in with your ZaloDesk account (opens the browser)
  zalodesk tools                      List the commands
  zalodesk <command> --help           Show a command's options
  zalodesk <command> [--option value] [--json '{...}']
  zalodesk logout

Examples:
  zalodesk list-accounts
  zalodesk list-conversations --account-id <id>
  zalodesk send-message --account-id <id> --conversation-id user:<id> --text "Chào anh"

https://zalodesk.com`;

class CliError extends Error {}
const fail = (message) => { throw new CliError(message); };
const b64url = (buffer) => buffer.toString('base64url');
const command = (name) => name.replaceAll('_', '-');

function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return null; }
}

function remember(clientId, token) {
  const auth = {
    client_id: clientId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: Date.now() + Number(token.expires_in ?? 3600) * 1000,
  };
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
  return auth;
}

function emailOf(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url')).email || ''; } catch { return ''; }
}

async function post(url, body, form = false) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', accept: 'application/json' },
    body: form ? new URLSearchParams(body) : JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* the URL is printed */ }
}

function callbackPage(request, ok) {
  const vi = /^vi\b/i.test(request.headers['accept-language'] || '');
  const text = ok
    ? (vi ? 'Đã đăng nhập ZaloDesk. Quay lại terminal.' : 'Signed in to ZaloDesk. Go back to the terminal.')
    : (vi ? 'Chưa đăng nhập được. Quay lại terminal.' : 'Sign-in did not finish. Go back to the terminal.');
  return `<!doctype html><meta charset="utf-8"><title>ZaloDesk</title><body style="font:16px system-ui;margin:48px">${text}</body>`;
}

async function login() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  let settle;
  const callback = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== '/callback') return response.writeHead(404, { connection: 'close' }).end();
    const code = url.searchParams.get('state') === state ? url.searchParams.get('code') : '';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end(callbackPage(request, Boolean(code)));
    if (code) settle.resolve(code);
    else settle.reject(new CliError(`Sign-in did not finish: ${url.searchParams.get('error_description') || url.searchParams.get('error') || 'unexpected answer'}.`));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const timer = setTimeout(() => settle.reject(new CliError('Sign-in timed out. Run zalodesk login again.')), 10 * 60 * 1000);
  try {
    const client = await post(`${MCP}/register`, {
      client_name: 'ZaloDesk CLI',
      redirect_uris: ['http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'none',
    });
    if (!client.ok) fail(`ZaloDesk did not answer (${client.status}). Try again.`);
    const authorize = new URL(`${MCP}/authorize`);
    for (const [key, value] of Object.entries({
      response_type: 'code', client_id: client.data.client_id, redirect_uri: redirectUri,
      code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'zalo',
    })) authorize.searchParams.set(key, value);
    console.log(`Sign in in your browser. If it did not open, go to:\n${authorize}\n`);
    openBrowser(authorize.href);
    const code = await callback;
    const token = await post(`${MCP}/token`, {
      grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.data.client_id, redirect_uri: redirectUri,
    }, true);
    if (!token.ok) fail(`Sign-in failed: ${token.data.error_description || token.status}.`);
    console.log(`Signed in as ${emailOf(remember(client.data.client_id, token.data).access_token)}.`);
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
  }
}

async function logout() {
  const auth = load();
  if (auth?.refresh_token) await post(`${MCP}/revoke`, { token: auth.refresh_token, client_id: auth.client_id }, true).catch(() => {});
  rmSync(FILE, { force: true });
  console.log('Signed out.');
}

async function session(refresh) {
  let auth = load();
  if (!auth?.refresh_token) fail('Not signed in. Run: zalodesk login');
  if (refresh || Date.now() > auth.expires_at - 60_000) {
    // The server replaces the refresh token on every use, so the new one is saved at once.
    const token = await post(`${MCP}/token`, { grant_type: 'refresh_token', refresh_token: auth.refresh_token, client_id: auth.client_id }, true);
    if (!token.ok) fail(token.status < 500 ? 'Your sign-in expired. Run: zalodesk login' : `ZaloDesk did not answer (${token.status}). Try again.`);
    auth = remember(auth.client_id, token.data);
  }
  return auth;
}

async function rpc(method, params) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const auth = await session(attempt > 0);
    const response = await fetch(MCP, {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (response.status === 401) continue;
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) fail(`ZaloDesk did not answer (${response.status}). Try again.`);
    if (data.error) fail(data.error.message);
    return data.result;
  }
  fail('Your sign-in expired. Run: zalodesk login');
}

function coerce(prop, value, flag) {
  if (prop.type === 'string') return value;
  if (prop.type === 'integer' || prop.type === 'number') {
    const number = Number(value);
    if (value === '' || !Number.isFinite(number)) fail(`${flag} must be a number.`);
    return number;
  }
  if (prop.type === 'boolean') {
    if (value === 'true' || value === 'false') return value === 'true';
    fail(`${flag} must be true or false.`);
  }
  try { return JSON.parse(value); } catch {
    return prop.type === 'array' ? value.split(',').map((item) => item.trim()).filter(Boolean) : value;
  }
}

function parseOptions(tool, argv) {
  const props = tool.inputSchema?.properties || {};
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) fail(`Unexpected argument: ${argv[i]}. Options look like --name value.`);
    const [key, inline] = argv[i].slice(2).split(/=(.*)/s, 2);
    const flag = `--${key}`;
    if (key === 'json') {
      const raw = inline ?? argv[++i];
      let parsed;
      try { parsed = JSON.parse(raw); } catch { fail('--json must be a JSON object.'); }
      Object.assign(args, parsed);
      continue;
    }
    let name = key.replaceAll('-', '_');
    let value = inline;
    if (!props[name] && name.startsWith('no_') && props[name.slice(3)]?.type === 'boolean') {
      name = name.slice(3);
      value = 'false';
    }
    const prop = props[name];
    if (!prop) fail(`Unknown option ${flag}. See: zalodesk ${command(tool.name)} --help`);
    if (value === undefined && prop.type === 'boolean') value = argv[i + 1] === 'true' || argv[i + 1] === 'false' ? argv[++i] : 'true';
    if (value === undefined) value = argv[++i];
    if (value === undefined) fail(`${flag} needs a value.`);
    args[name] = coerce(prop, value, flag);
  }
  const missing = (tool.inputSchema?.required || []).filter((name) => !(name in args));
  if (missing.length) fail(`Missing ${missing.map((name) => `--${command(name)}`).join(', ')}. See: zalodesk ${command(tool.name)} --help`);
  return args;
}

function typeOf(prop) {
  if (prop.enum) return prop.enum.join('|');
  if (prop.type && prop.type !== 'object' && prop.type !== 'array') return prop.type;
  return 'json';
}

function toolHelp(tool) {
  const props = tool.inputSchema?.properties || {};
  const required = new Set(tool.inputSchema?.required || []);
  const lines = [`zalodesk ${command(tool.name)}: ${tool.title || tool.name}`, '', tool.description || ''];
  const names = Object.keys(props);
  if (names.length) {
    lines.push('', 'Options:');
    for (const name of names) {
      const prop = props[name];
      const head = `  --${command(name)} <${typeOf(prop)}>${required.has(name) ? ' (required)' : ''}`;
      lines.push(prop.description ? `${head}\n      ${prop.description}` : head);
    }
  }
  return lines.join('\n');
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return console.log(USAGE);
  if (cmd === '--version' || cmd === '-v') return console.log(VERSION);
  if (cmd === 'login') return login();
  if (cmd === 'logout') return logout();
  const { tools } = await rpc('tools/list', {});
  if (cmd === 'tools') {
    const width = Math.max(...tools.map((tool) => command(tool.name).length));
    return console.log(tools.map((tool) => `${command(tool.name).padEnd(width)}  ${tool.title || ''}`).join('\n'));
  }
  const tool = tools.find((entry) => command(entry.name) === cmd || entry.name === cmd);
  if (!tool) fail(`Unknown command: ${cmd}. See: zalodesk tools`);
  if (rest.includes('--help') || rest.includes('-h')) return console.log(toolHelp(tool));
  const result = await rpc('tools/call', { name: tool.name, arguments: parseOptions(tool, rest) });
  const text = (result.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  if (result.isError) fail(text || 'ZaloDesk could not do that.');
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(text); }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof CliError ? error.message : `ZaloDesk could not be reached: ${error.cause?.code || error.message}`);
  process.exit(1);
});
