'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  safeStorage,
  shell,
} = require('electron');
const {
  DEFAULT_CONFIG,
  createAppServer,
  ensureDataFiles,
  readJson,
} = require('../server');

const desktopRoot = path.join(
  app.getPath('documents'),
  'AlgoCoach',
);
app.setPath('userData', desktopRoot);

let mainWindow = null;
let localServer = null;
let dataDir = null;
let exportsDir = null;
let keyPath = null;
let logPath = null;

function writeDesktopLog(message) {
  try {
    if (!logPath) {
      const logDir = app.getPath('userData');
      fs.mkdirSync(logDir, { recursive: true });
      logPath = path.join(logDir, 'desktop.log');
    }
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] ${String(message)}\n`,
      'utf8',
    );
  } catch {
    // 日志写入失败不应阻止应用启动。
  }
}

process.on('uncaughtException', (error) => {
  writeDesktopLog(`uncaughtException: ${error.stack || error.message}`);
});
process.on('unhandledRejection', (error) => {
  writeDesktopLog(`unhandledRejection: ${error?.stack || error}`);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
writeDesktopLog(`singleInstanceLock=${gotSingleInstanceLock}`);
if (!gotSingleInstanceLock) {
  app.quit();
}

function loadStoredApiKey() {
  try {
    if (!fs.existsSync(keyPath)) return '';
    const encrypted = fs.readFileSync(keyPath);
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(encrypted);
  } catch {
    return '';
  }
}

function applyApiKey(key) {
  if (key) {
    process.env.DEEPSEEK_API_KEY = key;
  } else {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
  }
}

function seedPackagedData(userDataDir) {
  dataDir = path.join(userDataDir, 'data');
  exportsDir = path.join(app.getPath('documents'), 'AlgoCoach', 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  const packagedProblemsPath = path.join(__dirname, '..', 'data', 'problems.json');
  const packagedProblems = fs.existsSync(packagedProblemsPath)
    ? readJson(packagedProblemsPath)
    : undefined;
  ensureDataFiles(dataDir, {
    config: DEFAULT_CONFIG,
    problems: packagedProblems,
  });
}

async function startLocalServer() {
  localServer = createAppServer({
    rootDir: path.join(__dirname, '..'),
    dataDir,
    publicDir: path.join(__dirname, '..', 'public'),
    exportDir: exportsDir,
  });
  await new Promise((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', resolve);
  });
  return localServer.address().port;
}

function registerDesktopHandlers() {
  ipcMain.handle('desktop:get-api-key-status', () => ({
    configured: Boolean(process.env.DEEPSEEK_API_KEY),
    encryptedAtRest: safeStorage.isEncryptionAvailable(),
  }));

  ipcMain.handle('desktop:save-api-key', (_event, value) => {
    const key = String(value || '').trim();
    if (!key || key.length < 20) {
      throw new Error('API Key 格式不正确');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows 安全存储当前不可用，未保存密钥');
    }
    fs.writeFileSync(keyPath, safeStorage.encryptString(key), { mode: 0o600 });
    applyApiKey(key);
    return { configured: true, encryptedAtRest: true };
  });

  ipcMain.handle('desktop:clear-api-key', () => {
    if (fs.existsSync(keyPath)) fs.rmSync(keyPath, { force: true });
    applyApiKey('');
    return { configured: false, encryptedAtRest: safeStorage.isEncryptionAvailable() };
  });

  ipcMain.handle('desktop:get-data-directory', () => dataDir);
  ipcMain.handle('desktop:open-data-directory', () => shell.openPath(dataDir));
  ipcMain.handle('desktop:open-exports-directory', () => shell.openPath(exportsDir));
}

async function createWindow() {
  writeDesktopLog('createWindow begin');
  const port = await startLocalServer();
  writeDesktopLog(`local server listening port=${port}`);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 860,
    minHeight: 680,
    show: false,
    backgroundColor: '#17130f',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => {
    writeDesktopLog('window ready-to-show');
    mainWindow.show();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    writeDesktopLog(`did-finish-load url=${mainWindow.webContents.getURL()}`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    writeDesktopLog(`did-fail-load code=${code} url=${url} description=${description}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeDesktopLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  writeDesktopLog(`loading url=http://127.0.0.1:${port}`);
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  writeDesktopLog('loadURL resolved');
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    writeDesktopLog(`app ready version=${app.getVersion()} userData=${app.getPath('userData')}`);
    const userDataDir = app.getPath('userData');
    fs.mkdirSync(userDataDir, { recursive: true });
    keyPath = path.join(userDataDir, 'api-key.bin');
    writeDesktopLog('loading stored API key');
    applyApiKey(loadStoredApiKey());
    writeDesktopLog('seeding packaged data');
    seedPackagedData(userDataDir);
    writeDesktopLog('registering desktop handlers');
    registerDesktopHandlers();
    writeDesktopLog('creating window');
    await createWindow();
    writeDesktopLog('window created');

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
  }).catch((error) => {
    writeDesktopLog(`startup failed: ${error.stack || error.message}`);
    console.error(error);
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (localServer) localServer.close();
  });
}
