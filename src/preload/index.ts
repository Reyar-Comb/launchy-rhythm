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
import type { ProjectApi, TrackProject } from '../shared/project'

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

const projectApi: ProjectApi = {
  list: () => ipcRenderer.invoke('projects:list'),
  create: () => ipcRenderer.invoke('projects:create'),
  load: (id: string) => ipcRenderer.invoke('projects:load', id),
  save: (project: TrackProject) => ipcRenderer.invoke('projects:save', project),
  readAudio: (id: string) => ipcRenderer.invoke('projects:read-audio', id),
  getStorageRoot: () => ipcRenderer.invoke('projects:get-storage-root')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('midi', midiApi)
    contextBridge.exposeInMainWorld('projects', projectApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.midi = midiApi
  // @ts-ignore (define in dts)
  window.projects = projectApi
}
