/// <reference types="vite/client" />

import type { MidiApi } from '../../shared/midi'
import type { ProjectApi } from '../../shared/project'

declare global {
  interface Window {
    midi: MidiApi
    projects: ProjectApi
  }
}

export {}
