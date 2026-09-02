import { Input, Output } from '@julusian/midi/lazy'
import type {
  ConnectMidiRequest,
  MidiConnectionState,
  MidiMessageEvent,
  MidiPortInfo,
  MidiPortsResult,
  PadPaletteRequest,
  PadRgbRequest
} from '../../shared/midi'

type MessageHandler = (event: MidiMessageEvent) => void
type ConnectionHandler = (state: MidiConnectionState) => void

const PROGRAMMER_MODE = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, 0x01, 0xf7]
const PROGRAMMER_LAYOUT = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x00, 0x7f, 0xf7]

export class MidiManager {
  private input: Input | null = null
  private output: Output | null = null
  private connection: MidiConnectionState = { connected: false }

  constructor(
    private readonly onMessage: MessageHandler,
    private readonly onConnection: ConnectionHandler
  ) {}

  getPorts(): MidiPortsResult {
    try {
      const input = new Input()
      const output = new Output()
      const inputs = this.readPorts(input, 'input')
      const outputs = this.readPorts(output, 'output')
      input.destroy()
      output.destroy()
      return { inputs, outputs }
    } catch (error) {
      return { inputs: [], outputs: [], error: this.errorMessage(error) }
    }
  }

  connect(request: ConnectMidiRequest): MidiConnectionState {
    this.disconnect()

    try {
      const input = new Input()
      const output = new Output()
      const inputPort = this.getPort(input, request.inputIndex, 'input')
      const outputPort = this.getPort(output, request.outputIndex, 'output')

      input.ignoreTypes(false, false, false)
      input.on('message', (deltaTime, raw) => {
        this.onMessage(this.describeMessage(deltaTime, [...raw]))
      })
      input.openPort(request.inputIndex)
      output.openPort(request.outputIndex)

      this.input = input
      this.output = output
      this.connection = {
        connected: true,
        input: inputPort,
        output: outputPort
      }
    } catch (error) {
      this.closeDevices()
      this.connection = { connected: false, error: this.errorMessage(error) }
    }

    this.onConnection(this.connection)
    return this.connection
  }

  disconnect(): MidiConnectionState {
    this.closeDevices()
    this.connection = { connected: false }
    this.onConnection(this.connection)
    return this.connection
  }

  send(message: number[]): { ok: boolean; error?: string } {
    if (!this.output || !this.connection.connected) {
      return { ok: false, error: '尚未连接 MIDI 输出端口' }
    }

    if (
      !message.length ||
      message.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    ) {
      return { ok: false, error: 'MIDI 消息必须由 0–255 的整数构成' }
    }

    try {
      this.output.sendMessage(message)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: this.errorMessage(error) }
    }
  }

  initializeLaunchpad(): { ok: boolean; error?: string } {
    const modeResult = this.send(PROGRAMMER_MODE)
    if (!modeResult.ok) return modeResult
    return this.send(PROGRAMMER_LAYOUT)
  }

  setPadRgb(request: PadRgbRequest): { ok: boolean; error?: string } {
    const note = this.clamp(request.note, 0, 127)
    const red = this.clamp(request.red, 0, 127)
    const green = this.clamp(request.green, 0, 127)
    const blue = this.clamp(request.blue, 0, 127)

    return this.send([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x03, 0x03, note, red, green, blue, 0xf7])
  }

  setPadPalette(request: PadPaletteRequest): { ok: boolean; error?: string } {
    const status = request.mode === 'flash' ? 0x91 : request.mode === 'pulse' ? 0x92 : 0x90
    return this.send([status, this.clamp(request.note, 0, 127), this.clamp(request.color, 0, 127)])
  }

  clearLaunchpad(): { ok: boolean; error?: string } {
    for (let row = 1; row <= 8; row += 1) {
      for (let column = 1; column <= 8; column += 1) {
        const result = this.send([0x90, row * 10 + column, 0])
        if (!result.ok) return result
      }
    }
    return { ok: true }
  }

  private readPorts(device: Input | Output, direction: 'input' | 'output'): MidiPortInfo[] {
    return Array.from({ length: device.getPortCount() }, (_, index) =>
      this.portInfo(index, device.getPortName(index), direction)
    )
  }

  private getPort(
    device: Input | Output,
    index: number,
    direction: 'input' | 'output'
  ): MidiPortInfo {
    if (!Number.isInteger(index) || index < 0 || index >= device.getPortCount()) {
      throw new Error(`无效的 MIDI ${direction === 'input' ? '输入' : '输出'}端口：${index}`)
    }
    return this.portInfo(index, device.getPortName(index), direction)
  }

  private portInfo(index: number, name: string, direction: 'input' | 'output'): MidiPortInfo {
    const normalized = name.toLowerCase()
    return {
      index,
      name,
      direction,
      isLaunchpadX: normalized.includes('launchpad x') || normalized.includes('lpx'),
      isDawPort: normalized.includes('daw')
    }
  }

  private describeMessage(deltaTime: number, raw: number[]): MidiMessageEvent {
    const status = raw[0] ?? 0
    const command = status & 0xf0
    const channel = (status & 0x0f) + 1
    const data1 = raw[1] ?? 0
    const data2 = raw[2] ?? 0
    const base = {
      receivedAt: Date.now(),
      deltaTime,
      raw,
      hex: raw.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    }

    if (command === 0x90 && data2 > 0) {
      return {
        ...base,
        type: 'Note On',
        channel,
        note: data1,
        velocity: data2,
        description: `按下 Note ${data1} · 力度 ${data2} · Channel ${channel}`
      }
    }

    if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      return {
        ...base,
        type: 'Note Off',
        channel,
        note: data1,
        velocity: data2,
        description: `松开 Note ${data1} · Channel ${channel}`
      }
    }

    if (command === 0xa0) {
      return {
        ...base,
        type: 'Poly Aftertouch',
        channel,
        note: data1,
        value: data2,
        description: `触后压力 Note ${data1} · 压力 ${data2} · Channel ${channel}`
      }
    }

    if (command === 0xb0) {
      return {
        ...base,
        type: 'Control Change',
        channel,
        controller: data1,
        value: data2,
        description: `控制器 CC ${data1} · 数值 ${data2} · Channel ${channel}`
      }
    }

    if (command === 0xd0) {
      return {
        ...base,
        type: 'Channel Pressure',
        channel,
        value: data1,
        description: `通道压力 ${data1} · Channel ${channel}`
      }
    }

    if (status === 0xf0) {
      return {
        ...base,
        type: 'System Exclusive',
        description: `SysEx · ${raw.length} bytes`
      }
    }

    if (status >= 0xf8) {
      return {
        ...base,
        type: 'System Realtime',
        description: `系统实时消息 0x${status.toString(16).toUpperCase()}`
      }
    }

    return {
      ...base,
      type: 'MIDI Message',
      channel: status < 0xf0 ? channel : undefined,
      description: `未分类消息 · ${base.hex}`
    }
  }

  private closeDevices(): void {
    try {
      this.input?.closePort()
      this.input?.destroy()
    } catch {
      // Closing an already-disconnected CoreMIDI port can throw; there is nothing else to clean up.
    }
    try {
      this.output?.closePort()
      this.output?.destroy()
    } catch {
      // Same as input cleanup above.
    }
    this.input = null
    this.output = null
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.round(value)))
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
