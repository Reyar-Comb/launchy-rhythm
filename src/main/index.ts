import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { MidiManager } from './midi/midi-manager'
import { ProjectStore } from './projects/project-store'
import { SettingsStore } from './settings/settings-store'
import type {
  ConnectMidiRequest,
  MidiConnectionState,
  MidiMessageEvent,
  PadPaletteRequest,
  PadRgbBatchRequest,
  PadRgbRequest
} from '../shared/midi'
import type { TrackProject } from '../shared/project'

let midiManager: MidiManager | null = null
let projectStore: ProjectStore | null = null
let settingsStore: SettingsStore | null = null

function broadcast(channel: string, payload: MidiMessageEvent | MidiConnectionState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

function registerMidiHandlers(): void {
  midiManager = new MidiManager(
    (event) => broadcast('midi:message', event),
    (state) => broadcast('midi:connection', state)
  )

  ipcMain.handle('midi:get-ports', () => midiManager?.getPorts())
  ipcMain.handle('midi:connect', (_event, request: ConnectMidiRequest) =>
    midiManager?.connect(request)
  )
  ipcMain.handle('midi:disconnect', () => midiManager?.disconnect())
  ipcMain.handle('midi:send', (_event, message: number[]) => midiManager?.send(message))
  ipcMain.handle('midi:initialize-launchpad', () => midiManager?.initializeLaunchpad())
  ipcMain.handle('midi:set-pad-rgb', (_event, request: PadRgbRequest) =>
    midiManager?.setPadRgb(request)
  )
  ipcMain.handle('midi:set-pads-rgb', (_event, request: PadRgbBatchRequest) =>
    midiManager?.setPadsRgb(request)
  )
  ipcMain.handle('midi:set-pad-palette', (_event, request: PadPaletteRequest) =>
    midiManager?.setPadPalette(request)
  )
  ipcMain.handle('midi:clear-launchpad', () => midiManager?.clearLaunchpad())
}

function registerProjectHandlers(store: ProjectStore): void {
  ipcMain.handle('projects:list', () => store.list())
  ipcMain.handle('projects:create', (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    return store.create(parentWindow)
  })
  ipcMain.handle('projects:load', (_event, id: string) => store.load(id))
  ipcMain.handle('projects:save', (_event, project: TrackProject) => store.save(project))
  ipcMain.handle('projects:delete', (_event, id: string) => store.delete(id))
  ipcMain.handle('projects:choose-cover', (event, id: string) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
    return store.chooseCover(id, parentWindow)
  })
  ipcMain.handle('projects:read-audio', (_event, id: string) => store.readAudio(id))
  ipcMain.handle('projects:read-source-audio', (_event, id: string) => store.readSourceAudio(id))
  ipcMain.handle('projects:read-cover', (_event, id: string) => store.readCover(id))
  ipcMain.handle('projects:get-storage-root', () => store.rootPath)
}

function registerSettingsHandlers(store: SettingsStore): void {
  ipcMain.handle('settings:load-playfield-effects', () => store.loadPlayfieldEffects())
  ipcMain.handle('settings:save-playfield-effects', (_event, settings) =>
    store.savePlayfieldEffects(settings)
  )
  ipcMain.handle('settings:load-midi-input', () => store.loadMidiInput())
  ipcMain.handle('settings:save-midi-input', (_event, settings) => store.saveMidiInput(settings))
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  registerMidiHandlers()
  projectStore = new ProjectStore()
  await projectStore.initialize()
  registerProjectHandlers(projectStore)
  settingsStore = new SettingsStore()
  await settingsStore.initialize()
  registerSettingsHandlers(settingsStore)

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  midiManager?.disconnect()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
