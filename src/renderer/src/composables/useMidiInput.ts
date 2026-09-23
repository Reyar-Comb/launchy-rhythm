import { computed, ref } from 'vue'
import type { MidiMessageEvent } from '../../../shared/midi'
import { MIDI_INPUT_DEFAULTS, type MidiInputSettings } from '../../../shared/settings'

let applyingPersistedSettings = false

function clamp(value: number, min: number, max: number, fallback: number): number {
  const next = Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.min(max, Math.max(min, Math.round(next)))
}

const storedVelocityThreshold = ref(MIDI_INPUT_DEFAULTS.velocityThreshold)
const storedDoublePressMs = ref(MIDI_INPUT_DEFAULTS.doublePressMs)
const storedOuterRingFadeMs = ref(MIDI_INPUT_DEFAULTS.outerRingFadeMs)

function currentSettings(): MidiInputSettings {
  return {
    velocityThreshold: storedVelocityThreshold.value,
    doublePressMs: storedDoublePressMs.value,
    outerRingFadeMs: storedOuterRingFadeMs.value
  }
}

function persist(): void {
  if (applyingPersistedSettings) return
  void window.settings.saveMidiInput(currentSettings())
}

const velocityThreshold = computed({
  get: () => storedVelocityThreshold.value,
  set: (value: number) => {
    storedVelocityThreshold.value = clamp(value, 1, 127, MIDI_INPUT_DEFAULTS.velocityThreshold)
    persist()
  }
})

const doublePressMs = computed({
  get: () => storedDoublePressMs.value,
  set: (value: number) => {
    storedDoublePressMs.value = clamp(value, 0, 250, MIDI_INPUT_DEFAULTS.doublePressMs)
    persist()
  }
})

const outerRingFadeMs = computed({
  get: () => storedOuterRingFadeMs.value,
  set: (value: number) => {
    storedOuterRingFadeMs.value = clamp(value, 0, 2000, MIDI_INPUT_DEFAULTS.outerRingFadeMs)
    persist()
  }
})

function applySettings(settings: MidiInputSettings): void {
  applyingPersistedSettings = true
  velocityThreshold.value = settings.velocityThreshold
  doublePressMs.value = settings.doublePressMs
  outerRingFadeMs.value = settings.outerRingFadeMs
  applyingPersistedSettings = false
}

async function load(): Promise<void> {
  const result = await window.settings.loadMidiInput()
  if (result.settings) applySettings(result.settings)
}

let lastAcceptedNote: number | null = null
let lastAcceptedAt = 0

function isNoteOnTrigger(event: MidiMessageEvent): event is MidiMessageEvent & { note: number } {
  return (
    event.type === 'Note On' &&
    event.note !== undefined &&
    (event.velocity ?? 0) >= velocityThreshold.value
  )
}

function acceptPadPress(note: number): boolean {
  const now = performance.now()
  if (
    note === lastAcceptedNote &&
    lastAcceptedAt > 0 &&
    now - lastAcceptedAt < doublePressMs.value
  ) {
    return false
  }

  lastAcceptedNote = note
  lastAcceptedAt = now
  return true
}

const midiInput = {
  velocityThreshold,
  doublePressMs,
  outerRingFadeMs,
  isNoteOnTrigger,
  acceptPadPress,
  load
}

export function useMidiInput(): typeof midiInput {
  return midiInput
}
