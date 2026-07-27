// The shape companion server. Adapted from Superpowers' visual-companion server
// (github.com/obra/superpowers, MIT) — branding and telemetry removed, env vars
// renamed SHAPE_*, sessions live under .quirks/shape-sessions/. Runs under Bun.
// Diverges from upstream in transport: Bun's node:http never fires the 'upgrade'
// event, so the hand-rolled WebSocket is replaced by SSE (server→browser reload
// signals) plus a POST /event route (browser→server clicks). Same auth, same
// events file. Retired by QK-COMP-003 when the quirks daemon absorbs the loop.
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MAX_EVENT_BODY_BYTES = 1 * 1024 * 1024;

// ========== Configuration ==========

const PORT_FILE = process.env.SHAPE_PORT_FILE || null;
const randomPort = () => 49152 + Math.floor(Math.random() * 16383);
// Prefer an explicit port, else the port this session last bound (so a restart
// reuses it and an already-open browser tab reconnects), else a random high port.
function preferredPort() {
  if (process.env.SHAPE_PORT) return Number(process.env.SHAPE_PORT);
  if (PORT_FILE) {
    try {
      const p = Number(fs.readFileSync(PORT_FILE, 'utf-8').trim());
      if (Number.isInteger(p) && p > 1023 && p < 65536) return p;
    } catch (e) { /* no prior port recorded */ }
  }
  return randomPort();
}
let PORT = preferredPort();
const HOST = process.env.SHAPE_HOST || '127.0.0.1';
const URL_HOST = process.env.SHAPE_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);
const SESSION_DIR = process.env.SHAPE_DIR || '/tmp/shape-companion';
const CONTENT_DIR = path.join(SESSION_DIR, 'content');
const STATE_DIR = path.join(SESSION_DIR, 'state');
let ownerPid = process.env.SHAPE_OWNER_PID ? Number(process.env.SHAPE_OWNER_PID) : null;

// Per-session secret key. The companion is reachable by any local browser tab
// and, when bound to a non-loopback host, by any host that can route to it.
// The key authenticates the real client uniformly across loopback, tunnel, and
// remote binds — and defeats DNS rebinding — where a Host/Origin allowlist
// cannot. It rides the served URL as ?key= and is mirrored into a cookie on
// first load so same-origin subresources and the WebSocket carry it for free.
// Persisted alongside the port (SHAPE_TOKEN_FILE) so a restart keeps the
// same key and an already-open tab's cookie still validates.
const TOKEN_FILE = process.env.SHAPE_TOKEN_FILE || null;
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function chmodOwnerOnly(file) {
  try { fs.chmodSync(file, 0o600); } catch (e) { /* best effort */ }
}

function initialToken() {
  if (process.env.SHAPE_TOKEN) {
    return { value: process.env.SHAPE_TOKEN, source: 'env' };
  }
  if (TOKEN_FILE) {
    try {
      const t = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
      if (/^[0-9a-f]{32,}$/i.test(t)) {
        chmodOwnerOnly(TOKEN_FILE);
        return { value: t, source: 'file' };
      }
    } catch (e) { /* no prior token recorded */ }
  }
  return { value: generateToken(), source: 'generated' };
}

const tokenInfo = initialToken();
let TOKEN = tokenInfo.value;
let tokenSource = tokenInfo.source;
let COOKIE_NAME = 'shape-key-' + PORT; // refined to the actual bound port in onListen

const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml'
};

// ========== Templates and Constants ==========

function waitingPage() {
  return renderBranding(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Shape companion</title>
<style>
body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
h1 { color: #333; } p { color: #666; }
.brand { display: flex; align-items: center; min-width: 0; overflow: hidden; margin-bottom: 1.5rem; color: #666; font-size: 0.9rem; line-height: 1; }
.brand-copy { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1; }
</style>
</head>
<body><!-- BRANDING --><h1>Shape companion</h1>
<p>Waiting for the session to push a screen…</p></body></html>`);
}

const FORBIDDEN_PAGE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Session key required</title>
<style>body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
h1 { color: #333; } p { color: #666; } code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 4px; }</style>
</head>
<body><h1>Session key required</h1>
<p>This page needs the full URL your agent gave you, including the
<code>?key=&hellip;</code> part. Copy the complete URL and open it again.</p></body></html>`;

function bootstrapPage(key) {
  const jsonKey = JSON.stringify(String(key));
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Opening shape companion</title></head>
<body>
<script>
try { sessionStorage.setItem('shape-session-key', ${jsonKey}); } catch (e) {}
location.replace('/');
</script>
</body>
</html>`;
}

const frameTemplate = fs.readFileSync(path.join(__dirname, 'frame-template.html'), 'utf-8');
const helperScript = fs.readFileSync(path.join(__dirname, 'helper.js'), 'utf-8');
const helperInjection = '<script>\n' + helperScript + '\n</script>';

// ========== Helper Functions ==========

function brandMarkup() {
  return '<div class="brand"><span class="brand-copy">Quirks · shape</span></div>';
}

function renderBranding(html) {
  return html.split('<!-- BRANDING -->').join(brandMarkup());
}

function isFullDocument(html) {
  const trimmed = html.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');
}

function wrapInFrame(content) {
  return renderBranding(frameTemplate).replace('<!-- CONTENT -->', content);
}

function getNewestScreen() {
  const files = fs.readdirSync(CONTENT_DIR)
    .filter(f => !f.startsWith('.') && f.endsWith('.html'))
    .map(f => {
      const fp = path.join(CONTENT_DIR, f);
      if (!isRegularFileInsideContentDir(fp)) return null;
      return { path: fp, mtime: fs.statSync(fp).mtime.getTime() };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return files.length > 0 ? files[0].path : null;
}

function urlHostForHttp(host) {
  const h = String(host);
  if (h.startsWith('[') && h.endsWith(']')) return h;
  return h.includes(':') ? '[' + h + ']' : h;
}

function companionUrl() {
  return 'http://' + urlHostForHttp(URL_HOST) + ':' + PORT + '/?key=' + TOKEN;
}

function browserLauncherForPlatform(url, {
  platform = process.platform,
  osRelease = require('os').release(),
  env = process.env
} = {}) {
  const isWSL = platform === 'linux' && /microsoft/i.test(osRelease);
  if (platform === 'darwin') return { bin: 'open', args: [url] };
  if (platform === 'win32' || isWSL) {
    return { bin: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return { bin: 'xdg-open', args: [url] };
  return null;
}

function isRegularFileInsideContentDir(filePath) {
  let stat, realContentDir, realFilePath;
  try {
    stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return false;
    if (!stat.isFile()) return false;
    if (stat.nlink !== 1) return false;
    realContentDir = fs.realpathSync(CONTENT_DIR);
    realFilePath = fs.realpathSync(filePath);
  } catch (e) {
    return false;
  }
  return realFilePath.startsWith(realContentDir + path.sep);
}

// ========== Authentication ==========

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

// A request is authorized if it carries the session key as ?key= or as the
// session cookie. Both are compared in constant time.
function isAuthorized(req) {
  const q = req.url.indexOf('?');
  if (q >= 0) {
    const params = new URLSearchParams(req.url.slice(q + 1));
    if (params.has('key')) {
      const key = params.get('key');
      return Boolean(key && timingSafeEqualStr(key, TOKEN));
    }
  }
  const cookie = parseCookies(req.headers['cookie'])[COOKIE_NAME];
  if (cookie && timingSafeEqualStr(cookie, TOKEN)) return true;
  return false;
}

function pathnameOf(url) {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

function queryKey(url) {
  const q = url.indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(url.slice(q + 1)).get('key');
}

function securityHeaders(headers = {}) {
  return {
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...headers
  };
}

// ========== HTTP Request Handler ==========

function handleRequest(req, res) {
  if (!isAuthorized(req)) {
    res.writeHead(403, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
    res.end(FORBIDDEN_PAGE);
    return;
  }
  touchActivity(); // only authorized requests count as activity

  // Mirror the key into a cookie so same-origin subresources (/files/*) can
  // authenticate after bootstrap. HttpOnly keeps it away from page scripts; the
  // WebSocket Origin check below is what blocks cross-origin localhost injection.
  res.setHeader('Set-Cookie',
    COOKIE_NAME + '=' + TOKEN + '; HttpOnly; SameSite=Strict; Path=/');

  const pathname = pathnameOf(req.url);
  const keyFromQuery = queryKey(req.url);
  if (req.method === 'GET' && pathname === '/' && keyFromQuery && timingSafeEqualStr(keyFromQuery, TOKEN)) {
    res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
    res.end(bootstrapPage(keyFromQuery));
  } else if (req.method === 'GET' && pathname === '/') {
    const screenFile = getNewestScreen();
    let html = screenFile
      ? (raw => isFullDocument(raw) ? raw : wrapInFrame(raw))(fs.readFileSync(screenFile, 'utf-8'))
      : waitingPage();

    if (html.includes('</body>')) {
      html = html.replace('</body>', helperInjection + '\n</body>');
    } else {
      html += helperInjection;
    }

    res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
    res.end(html);
  } else if (req.method === 'GET' && pathname === '/events-stream') {
    // SSE: the browser holds this open; broadcast() pushes reload signals down it.
    res.writeHead(200, securityHeaders({
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive'
    }));
    res.write('retry: 1000\n\n');
    clients.add(res);
    // Comment-line keepalive so idle proxies and Bun don't reap the stream.
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) { /* closed below */ }
    }, 15000);
    if (ping.unref) ping.unref();
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
  } else if (req.method === 'POST' && pathname === '/event') {
    // Click events from the page. SameSite=Strict cookie + the session key mean
    // a cross-origin page can't reach this authenticated.
    let body = '';
    let overflow = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_EVENT_BODY_BYTES) { overflow = true; req.destroy(); }
    });
    req.on('end', () => {
      if (overflow) return;
      handleMessage(body);
      res.writeHead(204, securityHeaders());
      res.end();
    });
  } else if (req.method === 'GET' && pathname.startsWith('/files/')) {
    const fileName = path.basename(pathname.slice(7));
    const filePath = path.join(CONTENT_DIR, fileName);
    // Reject empty/dotfile names and anything that isn't a regular file —
    // `/files/` would otherwise resolve to CONTENT_DIR and crash readFileSync (EISDIR).
    if (!fileName || fileName.startsWith('.') || !isRegularFileInsideContentDir(filePath)) {
      res.writeHead(404, securityHeaders());
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, securityHeaders({ 'Content-Type': contentType }));
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404, securityHeaders());
    res.end('Not found');
  }
}

// ========== Event Stream (SSE) Connection Handling ==========

const clients = new Set(); // open /events-stream responses

function handleMessage(text) {
  let event;
  try {
    event = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse WebSocket message:', e.message);
    return;
  }
  touchActivity();
  console.log(JSON.stringify({ source: 'user-event', ...event }));
  if (event && event.choice) {
    const eventsFile = path.join(STATE_DIR, 'events');
    fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n');
  }
}

function broadcast(msg) {
  const line = 'data: ' + JSON.stringify(msg) + '\n\n';
  for (const res of clients) {
    try { res.write(line); } catch (e) { clients.delete(res); }
  }
}

// Best-effort: open the user's browser the first time a screen is actually ready
// to show. Skips when disabled, on a non-loopback (remote) bind, or when a
// browser is already connected. Override the launcher with SHAPE_OPEN_CMD.
let browserOpened = false;
function maybeOpenBrowser() {
  if (browserOpened) return;
  browserOpened = true;
  if (!process.env.SHAPE_OPEN) return; // opt-in: only after the operator approves the companion
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') return;
  if (clients.size > 0) return; // the operator already opened it
  const url = companionUrl(); // must carry the key or the gate 403s it
  const cp = require('child_process');
  // Operator-provided launcher: run as given (this env var is trusted operator input).
  if (process.env.SHAPE_OPEN_CMD) {
    try { cp.exec(process.env.SHAPE_OPEN_CMD + ' ' + JSON.stringify(url), () => {}); } catch (e) { /* best effort */ }
    return;
  }
  // Platform launchers: pass the URL as an argv element via execFile (no shell),
  // so a url-host containing shell metacharacters can't inject a command.
  const launcher = browserLauncherForPlatform(url);
  if (!launcher) return; // headless: nothing to open
  try { cp.execFile(launcher.bin, launcher.args, () => {}); } catch (e) { /* best effort */ }
}

// ========== Activity Tracking ==========

// Idle timeout: shut down after this long with no activity. Default 4 hours;
// override with SHAPE_IDLE_TIMEOUT_MS (start-server.sh: --idle-timeout-minutes).
const IDLE_TIMEOUT_MS = (() => {
  const ms = Number(process.env.SHAPE_IDLE_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 4 * 60 * 60 * 1000;
})();
// How often the watchdog checks for owner-death / idleness. Configurable mainly
// so tests can run fast; production default is 60s.
const LIFECYCLE_CHECK_MS = (() => {
  const ms = Number(process.env.SHAPE_LIFECYCLE_CHECK_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 60 * 1000;
})();
let lastActivity = Date.now();

function touchActivity() {
  lastActivity = Date.now();
}

// ========== File Watching ==========

const debounceTimers = new Map();

// ========== Server Startup ==========

function startServer() {
  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

  // Track known files to distinguish new screens from updates.
  // macOS fs.watch reports 'rename' for both new files and overwrites,
  // so we can't rely on eventType alone.
  const knownFiles = new Set(
    fs.readdirSync(CONTENT_DIR).filter(f => !f.startsWith('.') && f.endsWith('.html'))
  );

  const server = http.createServer(handleRequest);

  const watcher = fs.watch(CONTENT_DIR, (eventType, filename) => {
    if (!filename || filename.startsWith('.') || !filename.endsWith('.html')) return;

    if (debounceTimers.has(filename)) clearTimeout(debounceTimers.get(filename));
    debounceTimers.set(filename, setTimeout(() => {
      debounceTimers.delete(filename);
      const filePath = path.join(CONTENT_DIR, filename);

      if (!fs.existsSync(filePath)) return; // file was deleted
      touchActivity();

      if (!knownFiles.has(filename)) {
        knownFiles.add(filename);
        const eventsFile = path.join(STATE_DIR, 'events');
        if (fs.existsSync(eventsFile)) fs.unlinkSync(eventsFile);
        console.log(JSON.stringify({ type: 'screen-added', file: filePath }));
        maybeOpenBrowser();
      } else {
        console.log(JSON.stringify({ type: 'screen-updated', file: filePath }));
      }

      broadcast({ type: 'reload' });
    }, 100));
  });
  watcher.on('error', (err) => console.error('fs.watch error:', err.message));

  function shutdown(reason) {
    console.log(JSON.stringify({ type: 'server-stopped', reason }));
    const infoFile = path.join(STATE_DIR, 'server-info');
    if (fs.existsSync(infoFile)) fs.unlinkSync(infoFile);
    fs.writeFileSync(
      path.join(STATE_DIR, 'server-stopped'),
      JSON.stringify({ reason, timestamp: Date.now() }) + '\n'
    );
    watcher.close();
    clearInterval(lifecycleCheck);
    // End any open SSE streams so server.close() can complete and the process
    // actually exits instead of lingering on an open connection.
    for (const res of clients) {
      try { res.end(); } catch (e) { /* already gone */ }
    }
    server.close(() => process.exit(0));
  }

  function ownerAlive() {
    if (!ownerPid) return true;
    // EPERM means the process exists but is not ours — a permission failure is
    // not evidence of death (the same carried defect the quirks store honors).
    try { process.kill(ownerPid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  }

  // Periodically exit if the owner process died or we've been idle too long.
  const lifecycleCheck = setInterval(() => {
    if (!ownerAlive()) shutdown('owner process exited');
    else if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) shutdown('idle timeout');
  }, LIFECYCLE_CHECK_MS);
  lifecycleCheck.unref();

  // Validate owner PID at startup. If it's already dead, the PID resolution
  // was wrong (common on WSL, Tailscale SSH, and cross-user scenarios).
  // Disable monitoring and rely on the idle timeout instead.
  if (ownerPid) {
    try { process.kill(ownerPid, 0); }
    catch (e) {
      if (e.code !== 'EPERM') {
        console.log(JSON.stringify({ type: 'owner-pid-invalid', pid: ownerPid, reason: 'dead at startup' }));
        ownerPid = null;
      }
    }
  }

  // If the preferred port is already taken (e.g. a previous server is still
  // alive), fall back to a random port once instead of failing.
  let triedFallback = false;

  function onListen() {
    // Cookie name keys on the ACTUAL bound port (may differ from the preferred
    // one after an EADDRINUSE fallback) so it can't collide with another server's
    // cookie in the shared localhost jar.
    COOKIE_NAME = 'shape-key-' + PORT;
    // Record the bound port AND token so the next restart of this session reuses
    // them — but ONLY when we got our preferred port. On a fallback we bound a
    // *different* port because someone else holds the preferred one; persisting
    // would overwrite the shared files and strand that other session's open tab.
    if (PORT_FILE && !triedFallback) {
      try { fs.writeFileSync(PORT_FILE, String(PORT)); } catch (e) { /* best effort */ }
      if (TOKEN_FILE) {
        try {
          fs.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
          chmodOwnerOnly(TOKEN_FILE);
        } catch (e) { /* best effort */ }
      }
    }
    const info = JSON.stringify({
      type: 'server-started', port: Number(PORT), host: HOST,
      url_host: URL_HOST, url: companionUrl(),
      screen_dir: CONTENT_DIR, state_dir: STATE_DIR, idle_timeout_ms: IDLE_TIMEOUT_MS
    });
    console.log(info);
    // server-info embeds the key — keep it owner-only.
    fs.writeFileSync(path.join(STATE_DIR, 'server-info'), info + '\n', { mode: 0o600 });
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !triedFallback) {
      if (tokenSource === 'env') {
        console.error('Server failed to bind: preferred port is in use and SHAPE_TOKEN is set; refusing fallback with explicit token');
        process.exit(1);
      }
      triedFallback = true;
      PORT = randomPort();
      if (tokenSource === 'file') {
        TOKEN = generateToken();
        tokenSource = 'generated-fallback';
      }
      server.listen(PORT, HOST, onListen);
    } else {
      console.error('Server failed to bind:', err.message);
      process.exit(1);
    }
  });
  server.listen(PORT, HOST, onListen);
}

if (require.main === module) {
  startServer();
}

module.exports = {
  browserLauncherForPlatform,
  MAX_EVENT_BODY_BYTES
};
