import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ConnectMidiRequest,
  MidiApi,
  MidiConnectionState,
  MidiMessageEvent,
  PadPaletteRequest,
  PadRgbRequest
} from '../shared/midi'

// Custom APIs for renderer
const midiApi: MidiApi = {
  getPorts: () => ipcRenderer.invoke('midi:get-ports'),
  connect: (request: ConnectMidiRequest) => ipcRenderer.invoke('midi:connect', request),
  disconnect: () => ipcRenderer.invoke('midi:disconnect'),
  send: (message: number[]) => ipcRenderer.invoke('midi:send', message),
  initializeLaunchpad: () => ipcRenderer.invoke('midi:initialize-launchpad'),
  setPadRgb: (request: PadRgbRequest) => ipcRenderer.invoke('midi:set-pad-rgb', request),
  setPadPalette: (request: PadPaletteRequest) =>
    ipcRenderer.invoke('midi:set-pad-palette', request),
  clearLaunchpad: () => ipcRenderer.invoke('midi:clear-launchpad'),
  onMessage: (callback: (event: MidiMessageEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: MidiMessageEvent): void =>
      callback(message)
    ipcRenderer.on('midi:message', listener)
    return () => ipcRenderer.removeListener('midi:message', listener)
  },
  onConnection: (callback: (state: MidiConnectionState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: MidiConnectionState): void =>
      callback(state)
    ipcRenderer.on('midi:connection', listener)
    return () => ipcRenderer.removeListener('midi:connection', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('midi', midiApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.midi = midiApi
}
