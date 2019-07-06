const electron = require("electron");

const {
  dialog,
  app,
  globalShortcut,
  Menu,
  Tray,
  clipboard
} = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");

var rememberStore = new Store({
  name: "remember",
  defaults: {}
});

app.setAppUserModelId("com.github.manuel777.mtgatool");

// Adds debug features like hotkeys for triggering dev tools and reload
require("electron-debug")({ showDevTools: false });
console.log(process.platform);

const debugBack = false;
const debugIPC = false;

var mainWindow = null;
var background = null;
var overlays = [];
var mainTimeout = null;

var tray = null;
var closeToTray = true;
let launchToTray = false;

const ipc = electron.ipcMain;

var mainLoaded = false;
var backLoaded = false;

const {
  OverlayProcess,
  setArenaState,
  setBackground
} = require("./window_overlay/overlay-process.js");

const singleLock = app.requestSingleInstanceLock();

app.on("second-instance", () => {
  if (mainWindow.isVisible()) {
    if (mainWindow.isMinimized()) {
      showWindow();
    }
  } else {
    showWindow();
  }
});

if (!singleLock) {
  console.log("We dont have single instance lock! quitting the app.");
  app.quit();
}

app.on("ready", () => {
  if (app.isPackaged) {
    // startUpdater();
  } else {
    require("devtron").install();
    startApp();
  }
});

let appStarted = false;

function startApp() {
  mainWindow = createMainWindow();
  background = createBackgroundWindow();
  setBackground(background);
  appStarted = true;

  globalShortcut.register("Alt+Shift+D", () => {
    if (!background.isVisible()) background.show();
    else background.hide();
    background.toggleDevTools();
    mainWindow.toggleDevTools();
  });

  globalShortcut.register("Alt+Shift+O", () => {
    overlays.forEach(overlay => overlay.window.toggleDevTools());
  });

  mainWindow.webContents.once("dom-ready", () => {
    mainLoaded = true;
    if (backLoaded == true) {
      background.webContents.send("start_background");
    }
  });

  background.webContents.once("dom-ready", () => {
    backLoaded = true;
    if (mainLoaded == true) {
      background.webContents.send("start_background");
    }
  });

  ipc.on("ipc_switch", function(event, method, from, arg, to) {
    const overlayMux = () =>
      overlays.forEach(overlay => overlay.window.webContents.send(method, arg));

    if (debugIPC && method != "log_read") {
      if (
        debugIPC == 2 &&
        method != "set_status" &&
        method != "set_db" &&
        method != "background_set_history_data"
      ) {
        console.log("IPC ", method + ": " + JSON.stringify(arg));
      } else {
        console.log("IPC ", method, "From:", from, "To:", to);
      }
    }
    switch (method) {
      case "ipc_log":
        console.log("IPC LOG: ", arg);
        break;

      case "ipc_error":
        console.log("IPC ERROR: ", arg);
        break;

      case "initial_settings":
        initialize(arg);
        break;

      case "set_settings":
        setSettings(arg);
        break;

      case "player_data_refresh":
        mainWindow.webContents.send("player_data_refresh");
        overlayMux();
        break;

      case "set_db":
        mainWindow.webContents.send("set_db", arg);
        overlayMux();
        break;

      case "popup":
        mainWindow.webContents.send("popup", arg.text, arg.time);
        if (arg.progress) {
          // set progress to <0 to disable
          // set progress to >1 for indeterminate time
          mainWindow.setProgressBar(arg.progress);
        }
        break;

      case "renderer_window_minimize":
        mainWindow.minimize();
        break;

      // to main js / window handling
      case "set_arena_state":
        setArenaState(arg);
        overlays.forEach(overlay => overlay.updateVisible());
        break;

      case "set_draft_cards":
        overlayMux();
        break;

      case "set_turn":
        overlayMux();
        break;

      case "overlay_minimize":
        overlays.forEach((overlay, index) => {
          if (index !== arg) return;
          if (overlay.window.isMinimized()) return;
          overlay.window.minimize();
        });
        break;

      case "renderer_set_bounds":
        mainWindow.setBounds(arg);
        break;

      case "show_background":
        background.show();
        break;

      case "renderer_show":
        showWindow();
        break;

      case "renderer_hide":
        hideWindow();
        break;

      case "renderer_window_close":
        if (closeToTray) {
          hideWindow();
        } else {
          quit();
        }
        break;

      case "set_close_to_tray":
        closeToTray = arg;
        break;

      case "set_clipboard":
        clipboard.writeText(arg);
        break;

      case "reset_overlay_pos":
        if (arg < overlays.length) {
          overlays[arg].window.setPosition(0, 0);
        }
        break;

      case "updates_check":
        console.log('Updater removed.');
        break;

      case "export_txt":
        dialog.showSaveDialog(
          {
            filters: [
              {
                name: "txt",
                extensions: ["txt"]
              }
            ],
            defaultPath: "~/" + arg.name + ".txt"
          },
          function(file_path) {
            if (file_path) {
              fs.writeFile(file_path, arg.str, function(err) {
                if (err) {
                  dialog.showErrorBox("Error", err);
                  return;
                }
              });
            }
          }
        );
        break;

      case "export_csvtxt":
        dialog.showSaveDialog(
          {
            filters: [
              {
                name: "csv",
                extensions: ["csv"]
              },
              {
                name: "txt",
                extensions: ["txt"]
              }
            ],
            defaultPath: "~/" + arg.name + ".csv"
          },
          function(file_path) {
            if (file_path) {
              fs.writeFile(file_path, arg.str, function(err) {
                if (err) {
                  dialog.showErrorBox("Error", err);
                  return;
                }
              });
            }
          }
        );
        break;

      default:
        if (to == 0) background.webContents.send(method, arg);
        if (to == 1) mainWindow.webContents.send(method, arg);
        if (to == 2) overlayMux();
        break;
    }
  });
}

function initialize(settings) {
  console.log("MAIN:  Initializing");
  closeToTray = settings.close_to_tray;
  launchToTray = settings.launch_to_tray;
  if (!launchToTray) showWindow();
}

function setSettings(settings) {
  console.log("MAIN:  Updating settings");
  app.setLoginItemSettings({
    openAtLogin: settings.startup
  });
  closeToTray = settings.close_to_tray;
  launchToTray = settings.launch_to_tray;
  mainWindow.webContents.send("settings_updated");

  settings.overlays.forEach((overlaySettings, index) => {
    if (index < overlays.length) {
      overlays[index].updateSettings(overlaySettings);
    } else {
      overlays.push(new OverlayProcess(overlaySettings, index));
    }
  });
}

// Catch exceptions
process.on("uncaughtException", function(err) {
  console.log("Uncaught exception;");
  console.log(err.stack);
  //console.log('Current chunk:',  currentChunk);
});

function onClosed() {
  mainWindow = null;
}

function hideWindow() {
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  }
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible()) {
    if (!mainWindow.isMinimized()) {
      mainWindow.minimize();
    } else {
      showWindow();
    }
  } else {
    showWindow();
  }
}

function showWindow() {
  if (mainWindow) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    } else {
      // https://electronjs.org/docs/api/browser-window
      // moveTop only supported on macOS and Windows
      if (mainWindow.hasOwnProperty('moveTop')) {
        mainWindow.moveTop();
      }
    }
  }
}

function quit() {
  app.quit();
}

function saveWindowPos() {
  var obj = {};
  var bounds = mainWindow.getBounds();
  var pos = mainWindow.getPosition();
  obj.width = Math.floor(bounds.width);
  obj.height = Math.floor(bounds.height);
  obj.x = Math.floor(pos[0]);
  obj.y = Math.floor(pos[1]);
  background.webContents.send("windowBounds", obj);
}

function createBackgroundWindow() {
  const win = new electron.BrowserWindow({
    frame: false,
    x: 0,
    y: 0,
    show: debugBack,
    width: 640,
    height: 480,
    title: "Background",
    icon: "icon.png",
    webPreferences: {
      nodeIntegration: true
    }
  });
  win.loadURL(`file://${__dirname}/window_background/index.html`);
  win.on("closed", onClosed);

  return win;
}

function createMainWindow() {
  const win = new electron.BrowserWindow({
    backgroundColor: "#000",
    frame: false,
    show: false,
    width: 800,
    height: 600,
    title: "MTG Arena Tool",
    icon: "icon.png",
    webPreferences: {
      nodeIntegration: true
    }
  });
  win.loadURL(`file://${__dirname}/window_main/index.html`);
  win.on("closed", onClosed);

  let iconPath = path.join(__dirname, "icon-tray.png");
  if (process.platform == "linux") {
    iconPath = path.join(__dirname, "icon-tray@8x.png");
  }
  if (process.platform == "win32") {
    iconPath = path.join(__dirname, "icon-tray@8x.png");
  }

  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => {
        showWindow();
      }
    },
    {
      label: "Quit",
      click: () => {
        quit();
      }
    }
  ]);
  tray.on("double-click", toggleWindow);
  tray.setToolTip("MTG Arena Tool");
  tray.setContextMenu(contextMenu);

  win.on("resize", () => {
    if (mainTimeout) {
      clearTimeout(mainTimeout);
      mainTimeout = null;
    }
    mainTimeout = setTimeout(function() {
      saveWindowPos();
      mainTimeout = null;
    }, 500);
  });

  win.on("move", function() {
    if (mainTimeout) {
      clearTimeout(mainTimeout);
      mainTimeout = null;
    }
    mainTimeout = setTimeout(function() {
      saveWindowPos();
      mainTimeout = null;
    }, 500);
  });

  return win;
}

app.on("window-all-closed", () => {
  quit();
});

app.on("activate", () => {
  if (!mainWindow) {
    mainWindow = createMainWindow();
  }
});
