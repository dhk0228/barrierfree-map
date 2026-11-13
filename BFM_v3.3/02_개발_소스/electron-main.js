const { app, BrowserWindow, dialog, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { startServer } = require("./server");
const { prepareDatabase, resolveDataHome } = require("./data-bootstrap");

app.setName("배리어 프리 맵 v3.3");
const appDataPath = app.getPath("appData");
const dataOverride = process.env.BFM_DATA_HOME;

let localServer;
let controlWindow;

async function startControlConsole() {
  try {
    const { databasePath } = await prepareDatabase({
      dataHome: app.getPath("userData"),
      appDataPath,
      usePrevious: dataOverride === undefined,
    });
    localServer = startServer({
      dbPath: databasePath,
      staticDir: __dirname,
      port: 0,
    });
    const { server } = localServer;
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const appUrl = `http://127.0.0.1:${server.address().port}`;
    controlWindow = new BrowserWindow({
      width: 980,
      height: 760,
      minWidth: 640,
      minHeight: 560,
      autoHideMenuBar: true,
      title: "배리어 프리 맵 운영 콘솔",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    controlWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    controlWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url === `${appUrl}/`) {
        shell.openExternal(url).catch((error) =>
          dialog.showErrorBox("웹 지도 열기 오류", error.message),
        );
      }
      return { action: "deny" };
    });
    await controlWindow.loadURL(`${appUrl}/control`);
  } catch (error) {
    dialog.showErrorBox(
      "배리어 프리 맵 실행 오류",
      `운영 콘솔을 열지 못했습니다.\n\n${error.message}`,
    );
    app.quit();
  }
}

try {
  const dataHome = resolveDataHome(appDataPath, dataOverride);
  fs.mkdirSync(dataHome, { recursive: true });
  app.setPath("userData", dataHome);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (!controlWindow || controlWindow.isDestroyed()) return;
      if (controlWindow.isMinimized()) controlWindow.restore();
      controlWindow.focus();
    });

    app.whenReady().then(startControlConsole);
    app.on("before-quit", (event) => {
      if (!localServer) return;
      event.preventDefault();
      const runtime = localServer;
      localServer = null;
      runtime.close(() => app.quit());
    });
  }
} catch (error) {
  dialog.showErrorBox("데이터 폴더 설정 오류", error.message);
  app.quit();
}
