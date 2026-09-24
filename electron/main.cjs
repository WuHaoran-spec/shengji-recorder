'use strict';

const { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_URL = 'shengji://app/';
const SOURCE_GRANT_MS = 30_000;
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'";
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png',
};

protocol.registerSchemesAsPrivileged([{
  scheme: 'shengji',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

let mainWindow;
let lastListedSources = new Set();
let selectedSource;

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'shengji:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
  } catch { return false; }
}

function isMainFrame(frame) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && frame
    && frame === mainWindow.webContents.mainFrame && isAppUrl(frame.url));
}

function verifySender(event) {
  if (!isMainFrame(event.senderFrame)) throw new Error('此操作仅允许声记主窗口调用。');
}

async function serveAsset(request) {
  if (!isAppUrl(request.url) || !['GET', 'HEAD'].includes(request.method)) {
    return new Response('Not found', { status: 404 });
  }
  // Only bundled web assets are exposed. The renderer never receives a file-system API.
  const root = path.join(app.getAppPath(), 'dist');
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url).pathname); }
  catch { return new Response('Bad request', { status: 400 }); }
  if (pathname.includes('\0') || pathname.includes('\\')) return new Response('Bad request', { status: 400 });
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
  } catch { return new Response('Not found', { status: 404 }); }
}

function installPermissions() {
  const ses = session.defaultSession;
  // A second boundary beyond CSP: installed builds never contact a remote server.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  ses.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (contents !== mainWindow?.webContents || !isAppUrl(origin)) return false;
    if (permission === 'media') return details.mediaType !== 'video';
    return permission === 'display-capture' && Boolean(selectedSource && selectedSource.expires > Date.now());
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const trusted = contents === mainWindow?.webContents && isAppUrl(details.requestingUrl || contents.getURL());
    const audioOnly = permission === 'media' && details.mediaTypes?.length > 0 && details.mediaTypes.every(type => type === 'audio');
    callback(Boolean(trusted && audioOnly));
  });
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    const choice = selectedSource;
    selectedSource = undefined; // One explicit selection authorizes exactly one capture.
    if (!isMainFrame(request.frame) || !isAppUrl(request.securityOrigin) || !choice || choice.expires <= Date.now()) {
      callback({}); return;
    }
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find(item => item.id === choice.id);
      if (!source || !isMainFrame(request.frame)) { callback({}); return; }
      callback({ video: source, ...(request.audioRequested && process.platform === 'win32' ? { audio: 'loopback' } : {}) });
    } catch { callback({}); }
  });

  ipcMain.handle('shengji:list-sources', async event => {
    verifySender(event);
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
    verifySender(event);
    lastListedSources = new Set(sources.map(source => source.id));
    selectedSource = undefined;
    return sources.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
  });
  ipcMain.handle('shengji:select-source', (event, id) => {
    verifySender(event);
    if (typeof id !== 'string' || !lastListedSources.has(id)) throw new Error('请重新选择要录制的屏幕或窗口。');
    selectedSource = { id, expires: Date.now() + SOURCE_GRANT_MS };
    lastListedSources.clear();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 880, minWidth: 860, minHeight: 620,
    title: '声记 · 离线录音与逐字稿', backgroundColor: '#f5f6fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, spellcheck: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = undefined; selectedSource = undefined; lastListedSources.clear(); });
  void mainWindow.loadURL(APP_URL);
}

// Smoke tests use an isolated directory and never touch the user's recording library.
if (process.env.SHENGJI_TEST_USER_DATA && !app.isPackaged) app.setPath('userData', process.env.SHENGJI_TEST_USER_DATA);
app.whenReady().then(() => {
  protocol.handle('shengji', serveAsset);
  installPermissions();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
