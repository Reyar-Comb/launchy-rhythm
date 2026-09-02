export interface MidiPortInfo {
  index: number
  name: string
  direction: 'input' | 'output'
  isLaunchpadX: boolean
  isDawPort: boolean
}

export interface MidiPortsResult {
  inputs: MidiPortInfo[]
  outputs: MidiPortInfo[]
  error?: string
}

export interface MidiConnectionState {
  connected: boolean
  input?: MidiPortInfo
  output?: MidiPortInfo
  error?: string
}

export interface MidiMessageEvent {
  receivedAt: number
  deltaTime: number
  raw: number[]
  hex: string
  type: string
  channel?: number
  note?: number
  velocity?: number
  controller?: number
  value?: number
  description: string
}

export interface ConnectMidiRequest {
  inputIndex: number
  outputIndex: number
}

export interface PadRgbRequest {
  note: number
  red: number
  green: number
  blue: number
}

export interface PadPaletteRequest {
  note: number
  color: number
  mode?: 'steady' | 'flash' | 'pulse'
}

export interface MidiApi {
  getPorts: () => Promise<MidiPortsResult>
  connect: (request: ConnectMidiRequest) => Promise<MidiConnectionState>
  disconnect: () => Promise<MidiConnectionState>
  send: (message: number[]) => Promise<{ ok: boolean; error?: string }>
  initializeLaunchpad: () => Promise<{ ok: boolean; error?: string }>
  setPadRgb: (request: PadRgbRequest) => Promise<{ ok: boolean; error?: string }>
  setPadPalette: (request: PadPaletteRequest) => Promise<{ ok: boolean; error?: string }>
  clearLaunchpad: () => Promise<{ ok: boolean; error?: string }>
  onMessage: (callback: (event: MidiMessageEvent) => void) => () => void
  onConnection: (callback: (state: MidiConnectionState) => void) => () => void
}
