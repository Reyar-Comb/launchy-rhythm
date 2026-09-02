/// <reference types="vite/client" />

import type { MidiApi } from '../../shared/midi'

declare global {
  interface Window {
    midi: MidiApi
  }
}

export {}
