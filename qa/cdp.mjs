// qa/cdp.mjs - dependency-free Chrome DevTools Protocol harness (Node 24 global WebSocket, no npm deps).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find((candidate) => candidate && existsSync(candidate)) || 'chrome';

export const fileUrl = (target) => pathToFileURL(path.resolve(target)).href;

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} }
  }
}

function globToRe(glob) {
  return new RegExp('^' + glob.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

async function portReady(port, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (ok) return;
    await sleep(100);
  }
  throw new Error('port ' + port + ' did not open');
}

export async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Serve a directory with python -m http.server on a free loopback port.
export async function serveDir(dir, { port } = {}) {
  const chosen = port ?? (await freePort());
  const proc = spawn(process.env.PYTHON || 'python', ['-m', 'http.server', String(chosen), '--bind', '127.0.0.1'], {
    cwd: path.resolve(dir), stdio: 'ignore', windowsHide: true,
  });
  await portReady(chosen);
  return {
    url: 'http://127.0.0.1:' + chosen + '/',
    origin: 'http://127.0.0.1:' + chosen,
    port: chosen,
    close: () => killTree(proc),
  };
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(this));
      this.ws.addEventListener('error', () => reject(new Error('CDP websocket failed: ' + wsUrl)));
    });
    this.ws.addEventListener('message', (event) => this.onMessage(event.data));
    this.ws.addEventListener('close', () => {
      this.closed = true;
      for (const entry of this.pending.values()) entry.reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
  }
  onMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.id) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message + ' (' + message.error.code + ')'));
      else entry.resolve(message.result);
      return;
    }
    const handlers = this.listeners.get(message.method);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try { handler(message.params, message.sessionId); } catch (error) { console.error('CDP listener error', message.method, error.message); }
    }
  }
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(handler);
    return () => { const set = this.listeners.get(method); if (set) set.delete(handler); };
  }
  send(method, params = {}, sessionId, timeout = 30000) {
    if (this.closed) return Promise.reject(new Error('CDP closed before ' + method));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeout);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      try { this.ws.send(JSON.stringify(message)); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const KEYS = {
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Enter: { code: 'Enter', keyCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  Space: { code: 'Space', keyCode: 32, key: ' ' },
};

class Page {
  constructor(browser, { targetId, sessionId, browserContextId }) {
    this.browser = browser;
    this.cdp = browser.cdp;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.browserContextId = browserContextId;
    this.events = { console: [], consoleErrors: [], exceptions: [], logEntries: [], requests: [], responses: [], failed: [] };
    this.requestsById = new Map();
    this.routes = [];
    this.fetchEnabled = false;
    this.unsubscribers = [];
  }

  async init() {
    const on = (method, handler) => this.unsubscribers.push(this.cdp.on(method, handler));
    for (const method of ['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable']) {
      await this.cdp.send(method, {}, this.sessionId);
    }
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, this.sessionId);

    on('Runtime.consoleAPICalled', (params, sessionId) => {
      if (sessionId !== this.sessionId) return;
      const text = params.args.map((arg) => {
        if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
        return arg.unserializableValue ?? arg.description ?? arg.type;
      }).join(' ');
      const entry = { type: params.type, text, ts: Date.now() };
      this.events.console.push(entry);
      if (params.type === 'error' || params.type === 'assert' || params.type === 'warning') this.events.consoleErrors.push(entry);
    });
    on('Runtime.exceptionThrown', (params, sessionId) => {
      if (sessionId !== this.sessionId) return;
      const details = params.exceptionDetails;
      this.events.exceptions.push({ text: details.exception?.description ?? details.text, url: details.url, line: details.lineNumber, ts: Date.now() });
    });
    on('Log.entryAdded', (params, sessionId) => {
      if (sessionId !== this.sessionId) return;
      const entry = params.entry;
      this.events.logEntries.push({ level: entry.level, source: entry.source, text: entry.text, url: entry.url, ts: Date.now() });
      if (entry.level === 'error') this.events.consoleErrors.push({ type: 'log', text: entry.text, ts: Date.now() });
    });
    on('Network.requestWillBeSent', (params, sessionId) => {
      if (sessionId !== this.sessionId) return;
      const request = { id: params.requestId, url: params.request.url, method: params.request.method, type: params.type, postData: typeof params.request.postData === 'string' ? params.request.postData.slice(0, 1500) : null, ts: Date.now() };
      this.requestsById.set(params.requestId, request);
      this.events.requests.push(request);
    });
    on('Network.responseReceived', (params, sessionId) => {
      if (sessionId !== this.sessionId) return;
      const request = this.requestsById.get(params.requestId);
      const response = { id: params.requestId, url: params.response.url, status: params.response.status, mimeType: params.response.mimeType, headers: params.response.headers ?? {}, ts: Date.now() };
      if (request) Object.assign(request, { status: response.status, mimeType: response.mimeType });
      this.events.responses.push(response);
    });
    on('Network.responseReceivedExtraInfo', (params, sessionId) => {
      if (sessionId !== this.sessionId) return;
      const response = this.events.responses.find((item) => item.id === params.requestId);
      if (response && params.headers) response.headers = { ...params.headers, ...response.headers };
    });
    on('Network.loadingFailed', (params, sessionId) => {
      if (sessionId !== this.sessionId) return;
      const request = this.requestsById.get(params.requestId);
      this.events.failed.push({ id: params.requestId, url: request?.url, errorText: params.errorText, ts: Date.now() });
    });
    on('Fetch.requestPaused', (params, sessionId) => this.handlePaused(params, sessionId));
    on('Page.javascriptDialogOpening', (params, sessionId) => {
      if (sessionId === this.sessionId) this.cdp.send('Page.handleJavaScriptDialog', { accept: true }, this.sessionId).catch(() => {});
    });
  }

  async goto(url, { timeout = 30000 } = {}) {
    await this.cdp.send('Page.navigate', { url }, this.sessionId);
    await this.waitFor((target) => {
      let same = location.href === target;
      if (!same) { try { same = decodeURI(location.href) === decodeURI(target); } catch {} }
      return same && document.readyState === 'complete';
    }, { args: [url], timeout, label: 'goto ' + url.slice(0, 80) });
    return this;
  }

  async reload({ timeout = 15000 } = {}) {
    const loaded = this.waitForEvent('Page.loadEventFired', timeout);
    await this.cdp.send('Page.reload', {}, this.sessionId);
    await loaded;
  }

  async evaluate(fn, ...args) {
    const expression = typeof fn === 'string' ? fn : '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')';
    const { result, exceptionDetails } = await this.cdp.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    }, this.sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  async waitFor(fn, { timeout = 10000, interval = 50, label = 'condition', args = [] } = {}) {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < timeout) {
      try {
        const value = await this.evaluate(fn, ...args);
        if (value) return value;
      } catch (error) { lastError = error; }
      await sleep(interval);
    }
    throw new Error('timeout waiting for ' + label + (lastError ? ' (' + lastError.message + ')' : ''));
  }

  async waitForSelector(selector, options = {}) {
    return this.waitFor((sel) => !!document.querySelector(sel), { args: [selector], label: 'selector ' + selector, ...options });
  }

  waitForEvent(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('timeout event ' + method)); }, timeout);
      const off = this.cdp.on(method, (params, sessionId) => {
        if (sessionId !== this.sessionId) return;
        clearTimeout(timer); off(); resolve(params);
      });
    });
  }

  async screenshot(file, { fullPage = false } = {}) {
    const params = { format: 'png' };
    if (fullPage) {
      const metrics = await this.cdp.send('Page.getLayoutMetrics', {}, this.sessionId);
      const size = metrics.cssContentSize ?? metrics.contentSize;
      Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 } });
    }
    const { data } = await this.cdp.send('Page.captureScreenshot', params, this.sessionId);
    const target = path.resolve(file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(data, 'base64'));
    return target;
  }

  async setViewport({ width = 1440, height = 900, deviceScaleFactor = 1, mobile = false, touch = false } = {}) {
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor, mobile, screenWidth: width, screenHeight: height,
    }, this.sessionId);
    await this.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!(touch || mobile), maxTouchPoints: 5 }, this.sessionId);
  }

  async setReducedMotion(reduce) {
    await this.cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }],
    }, this.sessionId);
  }

  async setOffline(offline) {
    await this.cdp.send('Network.emulateNetworkConditions', {
      offline, latency: 0, downloadThroughput: offline ? 0 : -1, uploadThroughput: offline ? 0 : -1,
    }, this.sessionId);
  }

  async localStorage() {
    return this.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  }

  async setLocalStorage(values) {
    return this.evaluate((entries) => {
      localStorage.clear();
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, String(value));
    }, values);
  }

  async clearLocalStorage() { return this.evaluate(() => localStorage.clear()); }

  async mouse(type, x, y, { button = 'left', buttons, clickCount = 1 } = {}) {
    const mask = buttons ?? (type === 'mouseReleased' ? 0 : 1);
    await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons: mask, clickCount }, this.sessionId);
  }

  async mouseDrag(from, to, { steps = 8, settle = 16 } = {}) {
    await this.mouse('mousePressed', from.x, from.y);
    for (let step = 1; step <= steps; step++) {
      await this.mouse('mouseMoved', from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps, { buttons: 1 });
      await sleep(settle);
    }
    await this.mouse('mouseReleased', to.x, to.y);
  }

  async touchDrag(from, to, { steps = 8, settle = 16 } = {}) {
    const point = (x, y) => [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 }];
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) }, this.sessionId);
    for (let step = 1; step <= steps; step++) {
      await this.cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: point(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps),
      }, this.sessionId);
      await sleep(settle);
    }
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, this.sessionId);
  }

  async tap(x, y) {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 }] }, this.sessionId);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, this.sessionId);
  }

  async key(name) {
    const def = KEYS[name] || { code: name, keyCode: 0 };
    const base = { key: def.key ?? name, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode };
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, this.sessionId);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, this.sessionId);
  }

  // URL glob pattern (e.g. '*graphql.anilist.co*'); handler returns {status, headers, body} to fulfill, or null to continue.
  async route(pattern, handler) {
    this.routes.push({ pattern, matcher: globToRe(pattern), handler });
    await this.cdp.send('Fetch.enable', {
      patterns: this.routes.map((item) => ({ urlPattern: item.pattern, requestStage: 'Request' })),
    }, this.sessionId);
    this.fetchEnabled = true;
  }

  async clearRoutes() {
    this.routes = [];
    if (this.fetchEnabled) { await this.cdp.send('Fetch.disable', {}, this.sessionId); this.fetchEnabled = false; }
  }

  async handlePaused(params, sessionId) {
    if (sessionId !== this.sessionId) return;
    try {
      for (const route of this.routes) {
        if (!route.matcher.test(params.request.url)) continue;
        const reply = await route.handler({ url: params.request.url, method: params.request.method, headers: params.request.headers, postData: params.request.postData });
        if (reply) {
          const responseHeaders = Object.entries(reply.headers ?? { 'content-type': 'application/json' }).map(([name, value]) => ({ name, value: String(value) }));
          await this.cdp.send('Fetch.fulfillRequest', {
            requestId: params.requestId, responseCode: reply.status ?? 200, responseHeaders,
            body: Buffer.from(reply.body ?? '').toString('base64'),
          }, sessionId);
        } else {
          await this.cdp.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId);
        }
        return;
      }
      await this.cdp.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId);
    } catch (error) {
      this.events.consoleErrors.push({ type: 'harness', text: 'route failed: ' + error.message, ts: Date.now() });
    }
  }

  async clearEvents() {
    this.events = { console: [], consoleErrors: [], exceptions: [], logEntries: [], requests: [], responses: [], failed: [] };
    this.requestsById.clear();
  }

  async insertText(text) {
    await this.cdp.send('Input.insertText', { text }, this.sessionId);
  }

  async focus(selector) {
    return this.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return false; el.focus(); return document.activeElement === el; }, selector);
  }

  async scrollTo(selector) {
    return this.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return false; el.scrollIntoView({ block: 'center' }); return true; }, selector);
  }

  async touch(type, points) {
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points || [] }, this.sessionId);
  }

  async url() { return this.evaluate(() => location.href); }
  async title() { return this.evaluate(() => document.title); }

  async close() {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}

class Browser {
  constructor(cdp, proc, userDataDir) {
    this.cdp = cdp;
    this.proc = proc;
    this.userDataDir = userDataDir;
    this.contexts = new Set();
    this.pages = new Set();
    this.version = '';
  }

  async newContext() {
    const { browserContextId } = await this.cdp.send('Target.createBrowserContext', { disposeOnDetach: false });
    this.contexts.add(browserContextId);
    const browser = this;
    return {
      browserContextId,
      newPage: (options = {}) => browser.newPage({ ...options, browserContextId }),
      close: async () => {
        if (!browser.contexts.delete(browserContextId)) return;
        await browser.cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
      },
    };
  }

  async grantPermissions(permissions, origin) {
    const params = { permissions };
    if (origin) params.origin = origin;
    await this.cdp.send('Browser.grantPermissions', params);
  }

  async newPage({ url = 'about:blank', browserContextId } = {}) {
    const params = { url: 'about:blank' };
    if (browserContextId) params.browserContextId = browserContextId;
    const { targetId } = await this.cdp.send('Target.createTarget', params);
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, { targetId, sessionId, browserContextId });
    await page.init();
    this.pages.add(page);
    if (url && url !== 'about:blank') await page.goto(url);
    return page;
  }

  async closePage(page) {
    this.pages.delete(page);
    await page.close();
  }

  async close() {
    killTree(this.proc);
    this.cdp.close();
    try { await fs.rm(this.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
}

export async function launchChrome({ headless = true, extraArgs = [], timeout = 30000 } = {}) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anigraph-chrome-'));
  const args = [
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--user-data-dir=' + userDataDir,
    ...(headless ? ['--headless=new'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-extensions',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-popup-blocking',
    '--mute-audio',
    '--hide-scrollbars',
    '--window-size=1440,900',
    ...extraArgs,
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore', windowsHide: true });
  let exitCode = null;
  proc.once('exit', (code) => { exitCode = code; });
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const started = Date.now();
  let lines = null;
  while (Date.now() - started < timeout) {
    try {
      const text = await fs.readFile(portFile, 'utf8');
      const parts = text.trim().split(/\r?\n/);
      if (parts.length >= 2 && parts[0]) { lines = parts; break; }
    } catch {}
    if (exitCode !== null) throw new Error('Chrome exited early with code ' + exitCode);
    await sleep(50);
  }
  if (!lines) {
    killTree(proc);
    throw new Error('Chrome did not write DevToolsActivePort within ' + timeout + 'ms (' + CHROME + ')');
  }
  const cdp = new CDP('ws://127.0.0.1:' + lines[0] + lines[1]);
  await cdp.ready;
  const browser = new Browser(cdp, proc, userDataDir);
  try {
    const { product } = await cdp.send('Browser.getVersion');
    browser.version = product;
  } catch (error) {
    killTree(proc);
    cdp.close();
    throw error;
  }
  return browser;
}
