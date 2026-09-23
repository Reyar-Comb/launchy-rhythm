export interface PlayfieldEffectSettings {
  playfieldBackgroundBrightness: number
  rippleDurationMs: number
  rippleRadius: number
  rippleWidth: number
  rippleFade: number
  rippleThreshold: number
  rippleGain: number
  rippleBrightness: number
}

export interface MidiInputSettings {
  velocityThreshold: number
  doublePressMs: number
  outerRingFadeMs: number
}

export interface PlayfieldEffectSettingsResult {
  settings?: PlayfieldEffectSettings
  error?: string
}

export interface MidiInputSettingsResult {
  settings?: MidiInputSettings
  error?: string
}

export interface SettingsApi {
  loadPlayfieldEffects: () => Promise<PlayfieldEffectSettingsResult>
  savePlayfieldEffects: (
    settings: PlayfieldEffectSettings
  ) => Promise<PlayfieldEffectSettingsResult>
  loadMidiInput: () => Promise<MidiInputSettingsResult>
  saveMidiInput: (settings: MidiInputSettings) => Promise<MidiInputSettingsResult>
}

export const PLAYFIELD_EFFECT_DEFAULTS: PlayfieldEffectSettings = {
  playfieldBackgroundBrightness: 18,
  rippleDurationMs: 200,
  rippleRadius: 5,
  rippleWidth: 0.38,
  rippleFade: 0.2,
  rippleThreshold: 0.05,
  rippleGain: 2.8,
  rippleBrightness: 2
}

export const MIDI_INPUT_DEFAULTS: MidiInputSettings = {
  velocityThreshold: 1,
  doublePressMs: 50,
  outerRingFadeMs: 500
}
