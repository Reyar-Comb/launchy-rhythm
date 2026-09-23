import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MIDI_INPUT_DEFAULTS,
  PLAYFIELD_EFFECT_DEFAULTS,
  type MidiInputSettings,
  type PlayfieldEffectSettings
} from '../../shared/settings'

const playfieldRanges: Record<keyof PlayfieldEffectSettings, [number, number]> = {
  playfieldBackgroundBrightness: [0, 64],
  rippleDurationMs: [80, 600],
  rippleRadius: [1.5, 5],
  rippleWidth: [0.2, 1.2],
  rippleFade: [0.05, 0.9],
  rippleThreshold: [0.02, 0.3],
  rippleGain: [1, 5],
  rippleBrightness: [0.2, 3]
}

const midiInputRanges: Record<keyof MidiInputSettings, [number, number]> = {
  velocityThreshold: [1, 127],
  doublePressMs: [0, 250],
  outerRingFadeMs: [0, 2000]
}

interface StoredSettings {
  playfieldEffects?: unknown
  midiInput?: unknown
}

function normalize<T extends object>(
  defaults: T,
  ranges: Record<keyof T, [number, number]>,
  value: unknown
): T {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<
    keyof T,
    unknown
  >
  const result = { ...defaults }
  for (const key of Object.keys(ranges) as Array<keyof T>) {
    const number = Number(source[key])
    if (!Number.isFinite(number)) continue
    const [min, max] = ranges[key]
    result[key] = Math.min(max, Math.max(min, number)) as T[keyof T]
  }
  return result
}

export class SettingsStore {
  readonly filePath = join(app.getPath('userData'), 'app-settings.json')
  private playfieldEffects = { ...PLAYFIELD_EFFECT_DEFAULTS }
  private midiInput = { ...MIDI_INPUT_DEFAULTS }

  async initialize(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf8')
      const stored = JSON.parse(content) as StoredSettings
      this.playfieldEffects = normalize(
        PLAYFIELD_EFFECT_DEFAULTS,
        playfieldRanges,
        stored.playfieldEffects
      )
      this.midiInput = normalize(MIDI_INPUT_DEFAULTS, midiInputRanges, stored.midiInput)
    } catch {
      this.playfieldEffects = { ...PLAYFIELD_EFFECT_DEFAULTS }
      this.midiInput = { ...MIDI_INPUT_DEFAULTS }
    }
  }

  loadPlayfieldEffects(): { settings: PlayfieldEffectSettings } {
    return { settings: { ...this.playfieldEffects } }
  }

  async savePlayfieldEffects(settings: PlayfieldEffectSettings): Promise<{ error?: string }> {
    try {
      this.playfieldEffects = normalize(PLAYFIELD_EFFECT_DEFAULTS, playfieldRanges, settings)
      await this.write()
      return {}
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  loadMidiInput(): { settings: MidiInputSettings } {
    return { settings: { ...this.midiInput } }
  }

  async saveMidiInput(settings: MidiInputSettings): Promise<{ error?: string }> {
    try {
      this.midiInput = normalize(MIDI_INPUT_DEFAULTS, midiInputRanges, settings)
      await this.write()
      return {}
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async write(): Promise<void> {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(
      this.filePath,
      `${JSON.stringify(
        { playfieldEffects: this.playfieldEffects, midiInput: this.midiInput },
        null,
        2
      )}\n`,
      'utf8'
    )
  }
}
