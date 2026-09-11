import { ElectronAPI } from '@electron-toolkit/preload'
import type { MidiApi } from '../shared/midi'
import type { ProjectApi } from '../shared/project'

declare global {
  interface Window {
    electron: ElectronAPI
    midi: MidiApi
    projects: ProjectApi
  }
}
