const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nonstopmaker',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

const DIST_DIRECTORY = path.resolve(__dirname, '..', 'dist');

function installAppProtocol() {
  protocol.handle('nonstopmaker', async (request) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (parsedUrl.hostname !== 'app') return new Response('Not found', { status: 404 });

    let relativePath;
    try {
      relativePath = decodeURIComponent(parsedUrl.pathname).replace(/^[/\\]+/, '') || 'index.html';
    } catch {
      return new Response('Bad path', { status: 400 });
    }

    const filePath = path.resolve(DIST_DIRECTORY, relativePath);
    if (filePath !== DIST_DIRECTORY && !filePath.startsWith(`${DIST_DIRECTORY}${path.sep}`)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 800,
    minHeight: 620,
    backgroundColor: '#07111f',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('nonstopmaker://app/')) event.preventDefault();
  });
  window.loadURL('nonstopmaker://app/index.html');
  return window;
}

app.whenReady().then(() => {
  installAppProtocol();
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('com.nonstopmaker.lite');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
