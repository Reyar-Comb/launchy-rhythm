import { computed, ref, type WritableComputedRef } from 'vue'
import { PLAYFIELD_EFFECT_DEFAULTS, type PlayfieldEffectSettings } from '../../../shared/settings'

let applyingPersistedSettings = false

function clamp(value: number, min: number, max: number, fallback: number): number {
  const next = Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.min(max, Math.max(min, next))
}

function numberSetting(fallback: number, min: number, max: number): WritableComputedRef<number> {
  const stored = ref(fallback)
  return computed({
    get: () => stored.value,
    set: (value: number) => {
      stored.value = clamp(value, min, max, fallback)
      persist()
    }
  })
}

const playfieldBackgroundBrightness = numberSetting(
  PLAYFIELD_EFFECT_DEFAULTS.playfieldBackgroundBrightness,
  0,
  64
)
const rippleDurationMs = numberSetting(PLAYFIELD_EFFECT_DEFAULTS.rippleDurationMs, 80, 600)
const rippleRadius = numberSetting(PLAYFIELD_EFFECT_DEFAULTS.rippleRadius, 1.5, 5)
const rippleWidth = numberSetting(PLAYFIELD_EFFECT_DEFAULTS.rippleWidth, 0.2, 1.2)
const rippleFade = numberSetting(PLAYFIELD_EFFECT_DEFAULTS.rippleFade, 0.05, 0.9)
const rippleThreshold = numberSetting(PLAYFIELD_EFFECT_DEFAULTS.rippleThreshold, 0.02, 0.3)
const rippleGain = numberSetting(PLAYFIELD_EFFECT_DEFAULTS.rippleGain, 1, 5)
const rippleBrightness = numberSetting(PLAYFIELD_EFFECT_DEFAULTS.rippleBrightness, 0.2, 3)

function currentSettings(): PlayfieldEffectSettings {
  return {
    playfieldBackgroundBrightness: playfieldBackgroundBrightness.value,
    rippleDurationMs: rippleDurationMs.value,
    rippleRadius: rippleRadius.value,
    rippleWidth: rippleWidth.value,
    rippleFade: rippleFade.value,
    rippleThreshold: rippleThreshold.value,
    rippleGain: rippleGain.value,
    rippleBrightness: rippleBrightness.value
  }
}

function persist(): void {
  if (applyingPersistedSettings) return
  void window.settings.savePlayfieldEffects(currentSettings())
}

function applySettings(settings: PlayfieldEffectSettings): void {
  applyingPersistedSettings = true
  playfieldBackgroundBrightness.value = settings.playfieldBackgroundBrightness
  rippleDurationMs.value = settings.rippleDurationMs
  rippleRadius.value = settings.rippleRadius
  rippleWidth.value = settings.rippleWidth
  rippleFade.value = settings.rippleFade
  rippleThreshold.value = settings.rippleThreshold
  rippleGain.value = settings.rippleGain
  rippleBrightness.value = settings.rippleBrightness
  applyingPersistedSettings = false
}

async function load(): Promise<void> {
  const result = await window.settings.loadPlayfieldEffects()
  if (result.settings) applySettings(result.settings)
}

function reset(): void {
  applySettings({ ...PLAYFIELD_EFFECT_DEFAULTS })
  persist()
}

const playfieldEffects = {
  playfieldBackgroundBrightness,
  rippleDurationMs,
  rippleRadius,
  rippleWidth,
  rippleFade,
  rippleThreshold,
  rippleGain,
  rippleBrightness,
  load,
  reset
}

export function usePlayfieldEffects(): typeof playfieldEffects {
  return playfieldEffects
}
