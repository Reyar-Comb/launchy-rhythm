import { ElectronAPI } from '@electron-toolkit/preload'
import type { MidiApi } from '../shared/midi'

declare global {
  interface Window {
    electron: ElectronAPI
    midi: MidiApi
  }
}
