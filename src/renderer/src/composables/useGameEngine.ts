import { readonly, ref, type Ref } from 'vue'
import type { GamePhase } from '../../../shared/game'
import {
  OUTER_RING_PAD_NOTES,
  getStepPadNotes,
  type ClipStep,
  type GameRound,
  type StepHitEffect,
  type TrackProject
} from '../../../shared/project'
import { useAudioEngine } from './useAudioEngine'
import { onTick } from './useTicker'
import { useMidiInput } from './useMidiInput'
import { usePlayfieldEffects } from './usePlayfieldEffects'
import type { PlaybackFadeOptions } from './useAudioEngine'

type PlaybackResult = 'ended' | 'stopped' | 'failed'
type GameEngineMode = 'real' | 'autoplay'
const MAX_ERROR_COUNT = 3
const AUDIO_START_FADE_SEC = 0.6
const DEFAULT_EARLY_INPUT_RATIO = 0.25
const PLAYFIELD_NOTE_COLOR = { red: 0, green: 205, blue: 225 }
const CORRECT_FLASH_COLOR = { red: 0, green: 255, blue: 0 }
const WRONG_FLASH_COLOR = { red: 255, green: 0, blue: 0 }
const EXPECTED_FLASH_COLOR = { red: 255, green: 80, blue: 0 }
const OUTER_RING_EDGES = [
  [11, 12, 13, 14, 15, 16, 17, 18],
  [18, 28, 38, 48, 58, 68, 78, 88],
  [88, 87, 86, 85, 84, 83, 82, 81],
  [81, 71, 61, 51, 41, 31, 21, 11]
]
const OUTER_RING_NOTES = Array.from(new Set(OUTER_RING_EDGES.flat()))
const PLAYFIELD_NOTES = Array.from({ length: 64 }, (_, index) => {
  const row = Math.floor(index / 8) + 1
  const column = (index % 8) + 1
  return row * 10 + column
}).filter((note) => !OUTER_RING_PAD_NOTES.has(note))
const OUTER_RING_BASE_COLOR = { red: 12, green: 48, blue: 180 }
const OUTER_RING_FINAL_COLOR = { red: 0, green: 82, blue: 255 }
const OUTER_RING_FLOW_DURATION_MS = 340
const OUTER_RING_SUCCESS_PEAK_COLOR = { red: 75, green: 255, blue: 115 }
const OUTER_RING_WRONG_PEAK_COLOR = { red: 255, green: 45, blue: 50 }
const RIPPLE_COLORS = [
  { red: 255, green: 76, blue: 76 },
  { red: 255, green: 216, blue: 46 },
  { red: 48, green: 78, blue: 255 }
]

interface GameEngine {
  phase: Readonly<Ref<GamePhase>>
  activeNotes: Readonly<Ref<ReadonlySet<number>>>
  backgroundNotes: Readonly<Ref<ReadonlySet<number>>>
  rippleNotes: Readonly<Ref<ReadonlySet<number>>>
  flashNotes: Readonly<Ref<ReadonlySet<number>>>
  errorNotes: Readonly<Ref<ReadonlySet<number>>>
  currentRoundIndex: Readonly<Ref<number>>
  currentStepIndex: Readonly<Ref<number>>
  result: Readonly<Ref<'none' | 'success' | 'failed'>>
  wrongNote: Readonly<Ref<number | null>>
  expectedNote: Readonly<Ref<number | null>>
  expectedNotes: Readonly<Ref<readonly number[]>>
  errorCount: Readonly<Ref<number>>
  prepare: () => Promise<boolean>
  start: () => Promise<void>
  startFrom: (startSec: number, mode?: GameEngineMode) => Promise<boolean>
  stop: () => void
  pressPad: (note: number) => Promise<void>
  releasePad: (note: number) => void
}

interface RippleEffect {
  token: number
  kind: StepHitEffect
  sources: Array<{ row: number; column: number }>
  color: { red: number; green: number; blue: number }
  trailColor: { red: number; green: number; blue: number }
  startedAt: number
  durationMs: number
}

export function useGameEngine(
  project: Ref<TrackProject | null>,
  roundsOverride?: Ref<GameRound[]>
): GameEngine {
  const {
    audioBuffer,
    loadedTrackId,
    load: loadAudio,
    play: playAudio,
    playClip: playClipAudio,
    stop: stopAudio
  } = useAudioEngine()
  const { acceptPadPress, outerRingFadeMs } = useMidiInput()
  const {
    playfieldBackgroundBrightness,
    rippleDurationMs,
    rippleRadius,
    rippleWidth,
    rippleFade,
    rippleThreshold,
    rippleGain,
    rippleBrightness
  } = usePlayfieldEffects()

  const phase = ref<GamePhase>('idle')
  const activeNotes = ref<ReadonlySet<number>>(new Set<number>())
  const backgroundNotes = ref<ReadonlySet<number>>(new Set<number>())
  const rippleNotes = ref<ReadonlySet<number>>(new Set<number>())
  const flashNotes = ref<ReadonlySet<number>>(new Set<number>())
  const errorNotes = ref<ReadonlySet<number>>(new Set<number>())
  const currentRoundIndex = ref(0)
  const currentStepIndex = ref(0)
  const result = ref<'none' | 'success' | 'failed'>('none')
  const wrongNote = ref<number | null>(null)
  const expectedNote = ref<number | null>(null)
  const expectedNotes = ref<readonly number[]>([])
  const errorCount = ref(0)

  let runToken = 0
  let promptTimers: number[] = []
  let effectTimers: number[] = []
  let outerRingEffectTimer: (() => void) | null = null
  let rippleEffectTimer: (() => void) | null = null
  let rippleEffects: RippleEffect[] = []
  let lastRippleNotes = new Set<number>()
  let runRounds: GameRound[] = []
  let runMode: GameEngineMode = 'real'
  const pressedPads = new Set<number>()
  let promptedSteps: ClipStep[] = []
  let activePromptStep: ClipStep | null = null
  let activeFlashStep: ClipStep | null = null
  let flashStepTimer: number | null = null
  const completedStepIds = new Set<string>()
  const suppressedPads = new Set<number>()
  let earlyInputEnabled = false
  let earlyInputAccepted = false
  let prePlayWarningActive = false
  let prePlayTargetsVisible = false
  let activePromptPlayback: Promise<PlaybackResult> | null = null

  async function prepare(): Promise<boolean> {
    const value = project.value
    if (!value) return false

    phase.value = 'loading'
    const buffer = await loadAudio(value.id)
    if (project.value?.id !== value.id) return false

    phase.value = buffer ? 'idle' : 'failed'
    return buffer !== null
  }

  async function start(): Promise<void> {
    await startFrom(
      Math.max(0, project.value?.runtimeRounds ? 0 : (project.value?.audioStartSec ?? 0)),
      'real'
    )
  }

  async function startFrom(startSec: number, mode: GameEngineMode = 'real'): Promise<boolean> {
    const value = project.value
    if (!value) return false
    const useRuntimeTimeline = !roundsOverride && Boolean(value.runtimeRounds)
    const sourceRounds = roundsOverride?.value ?? value.runtimeRounds ?? value.rounds
    if (sourceRounds.length === 0) return false

    const requestedStart = Number(startSec)
    if (!Number.isFinite(requestedStart) || requestedStart < 0) return false

    resetRun()
    const token = ++runToken
    runRounds = [...sourceRounds]
      .sort((a, b) => a.prompt.startSec - b.prompt.startSec)
      .map((round) => ({
        ...round,
        steps: [...round.steps].sort((a, b) => a.startSec - b.startSec)
      }))
    runMode = mode
    result.value = 'none'
    errorCount.value = 0
    wrongNote.value = null
    expectedNote.value = null
    expectedNotes.value = []
    errorNotes.value = new Set<number>()
    pressedPads.clear()
    phase.value = 'loading'

    if (loadedTrackId.value !== value.id) {
      const ready = await loadAudio(value.id)
      if (token !== runToken || !ready) {
        if (token === runToken) phase.value = 'failed'
        return false
      }
    }
    if (token !== runToken) return false

    const fullDuration = audioBuffer.value?.duration ?? value.durationSec
    const playbackEnd = useRuntimeTimeline
      ? Math.min(fullDuration, value.runtimeDurationSec ?? fullDuration)
      : Math.min(fullDuration, value.audioEndSec ?? fullDuration)
    const playbackStart = useRuntimeTimeline ? 0 : Math.min(requestedStart, playbackEnd)
    if (playbackStart >= playbackEnd - 0.001) {
      phase.value = 'idle'
      runRounds = []
      return false
    }

    runRounds = runRounds.filter((round) => round.prompt.startSec < playbackEnd - 0.001)
    const roundIndex = runRounds.findIndex(
      (round) => round.prompt.startSec + 0.001 >= playbackStart
    )
    const firstRound = runRounds[roundIndex]
    if (!firstRound) {
      phase.value = 'idle'
      runRounds = []
      return false
    }

    if (firstRound.prompt.startSec > playbackStart) {
      phase.value = 'playing-track'
      const playback = await playRange(
        playbackStart,
        Math.min(firstRound.prompt.startSec, playbackEnd),
        {
          fadeInSec: AUDIO_START_FADE_SEC,
          fadeOutSec: AUDIO_START_FADE_SEC
        }
      )
      if (token !== runToken || playback === 'stopped') return false
      if (playback === 'failed') {
        phase.value = 'failed'
        result.value = 'failed'
        return false
      }
    }

    await runRound(roundIndex, token)
    return true
  }

  function stop(): void {
    resetRun()
    result.value = 'none'
    errorCount.value = 0
    wrongNote.value = null
    expectedNote.value = null
    expectedNotes.value = []
    errorNotes.value = new Set<number>()
    pressedPads.clear()
    flashNotes.value = new Set<number>()
    phase.value = 'idle'
  }

  async function pressPad(note: number): Promise<void> {
    if (!acceptPadPress(note)) return

    const round = runRounds[currentRoundIndex.value]
    const step = round?.steps[currentStepIndex.value]
    const expected = step ? getStepPadNotes(step) : []
    if (
      !round ||
      !step ||
      expected.length === 0 ||
      !(
        phase.value === 'waiting-for-input' ||
        phase.value === 'playing-clip' ||
        (phase.value === 'prompting' && earlyInputEnabled)
      )
    ) {
      return
    }

    if (!expected.includes(note)) {
      registerWrongInput(note, expected, round)
      return
    }

    pressedPads.add(note)
    sendPadsColor([note], CORRECT_FLASH_COLOR)
    if (pressedPads.size < expected.length) return

    pressedPads.clear()
    await playCorrectStep(round, step, runToken)
  }

  function releasePad(note: number): void {
    if (!(
      phase.value === 'waiting-for-input' ||
      phase.value === 'playing-clip' ||
      (phase.value === 'prompting' && earlyInputEnabled)
    )) {
      return
    }

    const round = runRounds[currentRoundIndex.value]
    const step = round?.steps[currentStepIndex.value]
    if (!round || !step) return
    if (!getStepPadNotes(step).includes(note)) return
    if (!pressedPads.delete(note)) return

    if (pressedPads.size === 0) {
      registerWrongInput(note, getStepPadNotes(step), round)
      return
    }

    if (prePlayTargetsVisible) {
      lightPlayfieldStep(step)
    } else if (
      activePromptStep &&
      getStepPadNotes(activePromptStep).some((note) => getStepPadNotes(step).includes(note))
    ) {
      lightStep(activePromptStep, 1)
    } else {
      lightPlayfieldBackground(getStepPadNotes(step))
    }
  }

  async function playCorrectStep(round: GameRound, step: ClipStep, token: number): Promise<void> {
    finishFlashStep()
    if (earlyInputEnabled) {
      earlyInputAccepted = true
    }
    currentStepIndex.value += 1
    phase.value = 'playing-clip'
    prePlayWarningActive = false
    completedStepIds.add(step.id)
    if (prePlayTargetsVisible) showPlayfield(round)
    if (runMode === 'real') {
      startOuterRingFlow(
        token,
        OUTER_RING_FLOW_DURATION_MS,
        ['waiting-for-input', 'playing-clip'],
        OUTER_RING_BASE_COLOR,
        OUTER_RING_SUCCESS_PEAK_COLOR
      )
    }
    flashStep(step)

    const playback = await playClipRange(step.startSec, getStepPlaybackEnd(round, step))
    if (token !== runToken || playback === 'stopped') return
    if (playback === 'failed') {
      phase.value = 'failed'
      result.value = 'failed'
      return
    }

    if (currentStepIndex.value >= round.steps.length) {
      await completeRound(round, token)
      return
    }

    if (prePlayTargetsVisible) showPlayfield(round)

    if (runMode === 'real') {
      phase.value = 'waiting-for-input'
    }
  }

  function registerWrongInput(note: number, expected: readonly number[], round: GameRound): void {
    errorCount.value += 1
    wrongNote.value = note
    expectedNote.value = expected[0] ?? null
    expectedNotes.value = expected

    if (errorCount.value >= MAX_ERROR_COUNT) {
      fail(note, expected)
    } else {
      flashWrongPad(note, round)
    }
  }

  function getStepPlaybackEnd(round: GameRound, step: ClipStep): number {
    const steps = [...round.steps].sort((a, b) => a.startSec - b.startSec)
    const index = steps.findIndex((candidate) => candidate.id === step.id)
    const nextStep = steps[index + 1]
    return nextStep ? nextStep.startSec : round.play.endSec
  }

  async function runRound(index: number, token: number): Promise<void> {
    const round = runRounds[index]
    if (!round) return

    currentRoundIndex.value = index
    currentStepIndex.value = 0
    pressedPads.clear()
    promptedSteps = []
    activePromptStep = null
    completedStepIds.clear()
    suppressedPads.clear()
    earlyInputEnabled = false
    earlyInputAccepted = false
    prePlayWarningActive = false
    prePlayTargetsVisible = false
    activePromptPlayback = null
    phase.value = 'prompting'
    setActiveNotes([])
    backgroundNotes.value = new Set<number>()
    clearLaunchpad()
    showPlayfieldBackground()
    schedulePromptHighlights(round, token)
    schedulePrePlayWarning(round, token)
    let resolvePromptPlayback!: (reason: PlaybackResult) => void
    activePromptPlayback = new Promise((resolve) => {
      resolvePromptPlayback = resolve
    })

    const playback = await playRange(round.prompt.startSec, round.prompt.endSec)
    clearPromptTimers()
    earlyInputEnabled = false
    prePlayWarningActive = false
    resolvePromptPlayback(playback)
    if (token !== runToken) return
    if (playback === 'failed') {
      phase.value = 'failed'
      result.value = 'failed'
      return
    }
    if (playback === 'stopped') {
      if (!earlyInputAccepted) return
      activePromptPlayback = null
      return
    }

    if (earlyInputAccepted) {
      activePromptPlayback = null
      if (!prePlayTargetsVisible && currentStepIndex.value < round.steps.length) {
        prePlayTargetsVisible = true
        showPlayfield(round, true)
      }
      return
    }

    currentStepIndex.value = 0
    if (runMode === 'autoplay') {
      showPlayfield(round, true)
      await autoplayRound(round, token)
      return
    }

    phase.value = 'waiting-for-input'
    showPlayfield(round, true)
  }

  async function autoplayRound(round: GameRound, token: number): Promise<void> {
    const steps = [...round.steps].sort((a, b) => a.startSec - b.startSec)
    for (const [index, step] of steps.entries()) {
      if (token !== runToken) return
      currentStepIndex.value = index
      await playCorrectStep(round, step, token)
      if (token !== runToken) return
    }
  }

  async function completeRound(round: GameRound, token: number): Promise<void> {
    const value = project.value
    if (!value) return

    if (earlyInputAccepted && activePromptPlayback) {
      const promptPlayback = await activePromptPlayback
      if (token !== runToken || promptPlayback !== 'ended') return
    }

    currentStepIndex.value = round.steps.length
    phase.value = 'resuming-track'
    clearEffectTimers()
    stopRippleEffect()
    setActiveNotes([])
    backgroundNotes.value = new Set<number>()
    clearLaunchpad()

    const fullDuration = audioBuffer.value?.duration ?? value.durationSec
    const useRuntimeTimeline = !roundsOverride && Boolean(value.runtimeRounds)
    const playbackEnd = useRuntimeTimeline
      ? Math.min(fullDuration, value.runtimeDurationSec ?? fullDuration)
      : Math.min(fullDuration, value.audioEndSec ?? fullDuration)
    const resumeStart = round.play.endSec
    const nextRound = runRounds[currentRoundIndex.value + 1]
    const resumeEnd = nextRound ? Math.min(nextRound.prompt.startSec, playbackEnd) : playbackEnd

    if (resumeEnd > resumeStart) {
      const playback = await playRange(resumeStart, resumeEnd, {
        fadeOutSec: AUDIO_START_FADE_SEC
      })
      if (token !== runToken || playback === 'stopped') return
      if (playback === 'failed') {
        phase.value = 'failed'
        result.value = 'failed'
        return
      }
    }

    if (nextRound) {
      await runRound(currentRoundIndex.value + 1, token)
      return
    }

    result.value = 'success'
    phase.value = 'idle'
    setActiveNotes([])
    backgroundNotes.value = new Set<number>()
    clearLaunchpad()
  }

  function schedulePromptHighlights(round: GameRound, token: number): void {
    clearPromptTimers()
    promptedSteps = []
    let lastPromptStepId: string | null = null

    round.steps.forEach((step, index) => {
      const sourceStart = round.prompt.startSec + Math.max(0, step.startSec - round.play.startSec)
      const sourceEnd = round.prompt.startSec + Math.max(0, step.endSec - round.play.startSec)
      const pads = getStepPadNotes(step)

      promptTimers.push(
        window.setTimeout(
          () => {
            if (!isPromptTimelineActive(token)) return
            if (!earlyInputEnabled) currentStepIndex.value = index
            lastPromptStepId = step.id
            promptedSteps = [...promptedSteps, step]
            activePromptStep = step
            setActiveNotes(pads)
            lightStep(step)
          },
          Math.max(0, sourceStart - round.prompt.startSec) * 1000
        )
      )

      promptTimers.push(
        window.setTimeout(
          () => {
            if (!isPromptTimelineActive(token)) return
            if (lastPromptStepId !== step.id) return
            if (prePlayWarningActive) return
            activePromptStep = null
            setActiveNotes([])
            lightPlayfieldBackground(pads)
          },
          Math.max(0, sourceEnd - round.prompt.startSec) * 1000
        )
      )
    })
  }

  function schedulePrePlayWarning(round: GameRound, token: number): void {
    const explicitRevealAt =
      round.revealAtSec !== undefined && Number.isFinite(round.revealAtSec)
        ? Math.min(round.prompt.endSec, Math.max(round.prompt.startSec, round.revealAtSec))
        : null
    const revealAt = explicitRevealAt ?? round.play.startSec
    const fadeStart = Math.max(round.prompt.startSec, revealAt - outerRingFadeMs.value / 1000)
    const fadeDelayMs = Math.max(0, fadeStart - round.prompt.startSec) * 1000

    promptTimers.push(
      window.setTimeout(() => {
        if (
          token !== runToken ||
          (phase.value !== 'prompting' &&
            phase.value !== 'waiting-for-input' &&
            phase.value !== 'playing-clip')
        ) {
          return
        }
        startPrePlayWarning(
          token,
          Math.max(0, revealAt - fadeStart) * 1000,
          round,
          explicitRevealAt !== null
        )
      }, fadeDelayMs)
    )

    if (explicitRevealAt !== null || runMode !== 'real') return

    const bpm = bpmAt(round.play.startSec - 0.001)
    const beatSec = 60 / bpm
    const warningStart = Math.max(round.prompt.startSec, round.play.startSec - beatSec)
    const earlyInputAt =
      warningStart + (round.play.startSec - warningStart) * DEFAULT_EARLY_INPUT_RATIO
    promptTimers.push(
      window.setTimeout(
        () => {
          if (token !== runToken || phase.value !== 'prompting') return
          currentStepIndex.value = 0
          earlyInputEnabled = true
        },
        Math.max(0, earlyInputAt - round.prompt.startSec) * 1000
      )
    )
  }

  function startPrePlayWarning(
    token: number,
    durationMs: number,
    round: GameRound,
    explicitReveal: boolean
  ): void {
    stopOuterRingEffect()
    prePlayWarningActive = true

    const startedAt = performance.now()
    const promptFullBrightnessTimer = window.setTimeout(() => {
      if (
        token !== runToken ||
        (phase.value !== 'prompting' &&
          phase.value !== 'waiting-for-input' &&
          phase.value !== 'playing-clip')
      ) {
        return
      }

      revealPlayTargets(token, round, explicitReveal)
    }, durationMs)
    promptTimers.push(promptFullBrightnessTimer)

    if (durationMs <= 0) {
      sendOuterRingColor(OUTER_RING_FINAL_COLOR)
      return
    }

    outerRingEffectTimer = onTick(() => {
      if (
        token !== runToken ||
        (phase.value !== 'prompting' &&
          phase.value !== 'waiting-for-input' &&
          phase.value !== 'playing-clip')
      ) {
        stopOuterRingEffect()
        return
      }

      const elapsedMs = performance.now() - startedAt
      if (elapsedMs >= durationMs) {
        stopOuterRingEffect()
        return
      }

      const progress = Math.min(1, Math.max(0, elapsedMs / durationMs))
      const eased = progress * progress * (3 - 2 * progress)
      const activeNotePads = prePlayTargetsVisible
        ? round.steps.flatMap((step) => getStepPadNotes(step))
        : activePromptStep
          ? getStepPadNotes(activePromptStep)
          : []

      setActiveNotes([...OUTER_RING_NOTES, ...activeNotePads])
      sendOuterRingColor({
        red: Math.round(
          OUTER_RING_BASE_COLOR.red +
            (OUTER_RING_FINAL_COLOR.red - OUTER_RING_BASE_COLOR.red) * eased
        ),
        green: Math.round(
          OUTER_RING_BASE_COLOR.green +
            (OUTER_RING_FINAL_COLOR.green - OUTER_RING_BASE_COLOR.green) * eased
        ),
        blue: Math.round(
          OUTER_RING_BASE_COLOR.blue +
            (OUTER_RING_FINAL_COLOR.blue - OUTER_RING_BASE_COLOR.blue) * eased
        )
      })
    })
  }

  function revealPlayTargets(token: number, round: GameRound, explicitReveal: boolean): void {
    if (
      token !== runToken ||
      (phase.value !== 'prompting' &&
        phase.value !== 'waiting-for-input' &&
        phase.value !== 'playing-clip')
    ) {
      return
    }

    prePlayTargetsVisible = true
    showPlayfield(round)
    sendOuterRingColor(OUTER_RING_FINAL_COLOR)
    if (explicitReveal && runMode === 'real') {
      currentStepIndex.value = 0
      earlyInputEnabled = true
    }
  }

  function startOuterRingFlow(
    token: number,
    durationMs: number,
    allowedPhases: readonly GamePhase[],
    baseColor: { red: number; green: number; blue: number },
    peakColor: { red: number; green: number; blue: number }
  ): void {
    stopOuterRingEffect()
    const startedAt = performance.now()
    const renderFrame = (): void => {
      if (token !== runToken || !allowedPhases.includes(phase.value)) {
        stopOuterRingEffect()
        return
      }

      const elapsedMs = performance.now() - startedAt
      if (elapsedMs >= durationMs) {
        sendOuterRingColor(OUTER_RING_BASE_COLOR)
        stopOuterRingEffect()
        return
      }

      const flowProgress = elapsedMs / durationMs
      window.midi.setPadsRgb({
        pads: OUTER_RING_EDGES.flatMap((edge) =>
          edge.map((note, index) => {
            const distanceFromCenter = Math.abs(index - 3.5)
            const pulseDistance = -0.15 + flowProgress * 4.1
            const pulse = Math.exp(-Math.pow((distanceFromCenter - pulseDistance) / 0.4, 2))

            return {
              note,
              red: Math.round(baseColor.red + (peakColor.red - baseColor.red) * pulse),
              green: Math.round(baseColor.green + (peakColor.green - baseColor.green) * pulse),
              blue: Math.round(baseColor.blue + (peakColor.blue - baseColor.blue) * pulse)
            }
          })
        )
      })
    }

    outerRingEffectTimer = onTick(renderFrame)
  }

  function playRange(
    startSec: number,
    endSec: number,
    fade?: PlaybackFadeOptions
  ): Promise<PlaybackResult> {
    return playbackWith(
      (start, end, onEnded) => playAudio(start, end, onEnded, fade),
      startSec,
      endSec
    )
  }

  function playClipRange(startSec: number, endSec: number): Promise<PlaybackResult> {
    return playbackWith(playClipAudio, startSec, endSec)
  }

  function playbackWith(
    play: (
      startSec: number,
      endSec: number,
      onEnded: (reason: 'ended' | 'stopped') => void
    ) => Promise<boolean>,
    startSec: number,
    endSec: number
  ): Promise<PlaybackResult> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (reason: PlaybackResult): void => {
        if (settled) return
        settled = true
        resolve(reason)
      }

      void play(startSec, endSec, (reason) => finish(reason)).then((started) => {
        if (!started) finish('failed')
      })
    })
  }

  function fail(note: number, expected: readonly number[]): void {
    stopAudio()
    ++runToken
    clearPromptTimers()
    clearEffectTimers()
    stopRippleEffect()
    pressedPads.clear()
    phase.value = 'failed'
    result.value = 'failed'
    wrongNote.value = note
    expectedNote.value = expected[0] ?? null
    expectedNotes.value = expected
    setActiveNotes([note, ...expected])
    flashNotes.value = new Set<number>()
    errorNotes.value = new Set<number>([note])
    void window.midi.setPadsRgb({
      pads: [
        padColor(note, WRONG_FLASH_COLOR),
        ...expected.map((expectedNote) => padColor(expectedNote, EXPECTED_FLASH_COLOR))
      ]
    })
  }

  function flashWrongPad(note: number, round: GameRound): void {
    pressedPads.clear()
    if (OUTER_RING_PAD_NOTES.has(note)) {
      stopOuterRingEffect()
      if (prePlayTargetsVisible) showPlayfield(round)
    }
    errorNotes.value = new Set<number>([note])
    sendPadsColor([note], WRONG_FLASH_COLOR)
    startOuterRingFlow(
      runToken,
      OUTER_RING_FLOW_DURATION_MS,
      ['prompting', 'waiting-for-input', 'playing-clip'],
      OUTER_RING_BASE_COLOR,
      OUTER_RING_WRONG_PEAK_COLOR
    )

    const timer = window.setTimeout(() => {
      errorNotes.value = new Set<number>()
      if (!prePlayTargetsVisible) {
        if (activePromptStep && getStepPadNotes(activePromptStep).includes(note)) {
          lightStep(activePromptStep, 1)
        } else {
          if (OUTER_RING_PAD_NOTES.has(note)) {
            darkenNotes([note])
          } else {
            lightPlayfieldBackground([note])
          }
        }
      } else {
        const pendingSteps = round.steps.filter((step) => !completedStepIds.has(step.id))
        const pendingPads = new Set(
          pendingSteps
            .flatMap((step) => getStepPadNotes(step))
            .filter((pendingNote) => !suppressedPads.has(pendingNote))
        )
        if (pendingPads.has(note)) {
          lightNotes([note], PLAYFIELD_NOTE_COLOR)
        } else {
          if (OUTER_RING_PAD_NOTES.has(note)) {
            suppressedPads.add(note)
            darkenNotes([note])
          } else {
            lightPlayfieldBackground([note])
          }
          setActiveNotes([...activeNotes.value].filter((activeNote) => activeNote !== note))
        }
        lightNotes([...pendingPads], PLAYFIELD_NOTE_COLOR)
      }
      effectTimers = effectTimers.filter((value) => value !== timer)
    }, 220)
    effectTimers.push(timer)
  }

  function resetRun(): void {
    ++runToken
    clearPromptTimers()
    clearEffectTimers()
    pressedPads.clear()
    promptedSteps = []
    activePromptStep = null
    completedStepIds.clear()
    suppressedPads.clear()
    earlyInputEnabled = false
    earlyInputAccepted = false
    prePlayWarningActive = false
    prePlayTargetsVisible = false
    activePromptPlayback = null
    stopAudio()
    setActiveNotes([])
    backgroundNotes.value = new Set<number>()
    stopRippleEffect()
    flashNotes.value = new Set<number>()
    errorNotes.value = new Set<number>()
    clearLaunchpad()
  }

  function setActiveNotes(notes: number[]): void {
    activeNotes.value = new Set(notes)
  }

  function isPromptTimelineActive(token: number): boolean {
    return (
      token === runToken &&
      activePromptPlayback !== null &&
      (phase.value === 'prompting' ||
        phase.value === 'playing-clip' ||
        phase.value === 'waiting-for-input')
    )
  }

  function showPlayfield(round: GameRound, clearFirst = false): void {
    const pendingSteps = round.steps.filter((step) => !completedStepIds.has(step.id))
    const notePads = pendingSteps
      .flatMap((step) => getStepPadNotes(step))
      .filter((note) => !suppressedPads.has(note))
    const outerRingNotes = [...OUTER_RING_PAD_NOTES].filter((note) => !suppressedPads.has(note))
    const targetNotes = new Set(notePads)
    const backgroundPadNotes = PLAYFIELD_NOTES.filter(
      (note) => !targetNotes.has(note) && !suppressedPads.has(note)
    )
    setActiveNotes([...outerRingNotes, ...notePads])
    backgroundNotes.value = new Set(backgroundPadNotes)
    if (clearFirst) clearLaunchpad()
    sendPadsColor(backgroundPadNotes, playfieldBackgroundColor())
    lightNotes(outerRingNotes, OUTER_RING_FINAL_COLOR)
    lightNotes(notePads, PLAYFIELD_NOTE_COLOR)
  }

  function showPlayfieldBackground(): void {
    const notes = PLAYFIELD_NOTES.filter((note) => !suppressedPads.has(note))
    backgroundNotes.value = new Set(notes)
    sendPadsColor(notes, playfieldBackgroundColor())
  }

  function lightPlayfieldStep(step: ClipStep): void {
    lightNotes(getStepPadNotes(step), PLAYFIELD_NOTE_COLOR)
  }

  function flashStep(step: ClipStep): void {
    finishFlashStep()
    activeFlashStep = step
    const pads = getStepPadNotes(step)
    flashNotes.value = new Set(pads)
    sendPadsColor(pads, CORRECT_FLASH_COLOR)
    startRippleEffect(pads, step.hitEffect ?? 'cross')

    flashStepTimer = window.setTimeout(() => {
      finishFlashStep()
    }, 180)
  }

  function finishFlashStep(): void {
    const step = activeFlashStep
    if (!step) return

    if (flashStepTimer !== null) {
      window.clearTimeout(flashStepTimer)
      flashStepTimer = null
    }
    activeFlashStep = null
    flashNotes.value = new Set<number>()

    const pads = getStepPadNotes(step)
    if (!prePlayTargetsVisible) {
      if (
        activePromptStep &&
        getStepPadNotes(activePromptStep).some((note) => pads.includes(note))
      ) {
        lightStep(activePromptStep, 1)
      } else {
        lightPlayfieldBackground(pads)
      }
      return
    }

    const currentRound = runRounds[currentRoundIndex.value]
    if (!currentRound) return

    const pendingSteps = currentRound.steps.filter(
      (candidate) => !completedStepIds.has(candidate.id)
    )
    const pendingPads = new Set(
      pendingSteps
        .flatMap((candidate) => getStepPadNotes(candidate))
        .filter((note) => !suppressedPads.has(note))
    )
    const completedPadsWithoutFutureUse = pads.filter(
      (note) => !pendingPads.has(note) && !suppressedPads.has(note)
    )

    lightPlayfieldBackground(completedPadsWithoutFutureUse)
    lightNotes([...pendingPads], PLAYFIELD_NOTE_COLOR)
  }

  function startRippleEffect(sourceNotes: readonly number[], kind: StepHitEffect): void {
    const colorIndex = Math.floor(Math.random() * RIPPLE_COLORS.length)
    let trailIndex = Math.floor(Math.random() * RIPPLE_COLORS.length)
    if (trailIndex === colorIndex) {
      trailIndex =
        (trailIndex + 1 + Math.floor(Math.random() * (RIPPLE_COLORS.length - 1))) %
        RIPPLE_COLORS.length
    }

    rippleEffects.push({
      token: runToken,
      kind,
      sources: sourceNotes.map(padPosition),
      color: RIPPLE_COLORS[colorIndex],
      trailColor: RIPPLE_COLORS[trailIndex],
      startedAt: performance.now(),
      durationMs: rippleDurationMs.value
    })

    startPlayfieldEffectLoop(runToken)
  }

  function startPlayfieldEffectLoop(token: number): void {
    if (rippleEffectTimer !== null) return
    rippleEffectTimer = onTick((now) => renderRippleFrame(token, now))
  }

  function renderRippleFrame(token: number, now = performance.now()): void {
    if (
      token !== runToken ||
      rippleEffects.some((effect) => effect.token !== runToken) ||
      (phase.value !== 'prompting' &&
        phase.value !== 'waiting-for-input' &&
        phase.value !== 'playing-clip')
    ) {
      stopRippleEffect()
      return
    }

    rippleEffects = rippleEffects.filter((effect) => now - effect.startedAt < effect.durationMs)
    if (rippleEffects.length === 0) {
      restoreRippleBackground()
      stopRippleEffect()
      return
    }

    const rayIntensities = new Map<number, number>()
    const rayColors = new Map<number, { red: number; green: number; blue: number }>()
    for (const note of PLAYFIELD_NOTES) {
      const position = padPosition(note)
      let sourceIntensity = 0
      let redWeight = 0
      let greenWeight = 0
      let blueWeight = 0
      for (const effect of rippleEffects) {
        const progress = Math.min(1, (now - effect.startedAt) / effect.durationMs)
        const travel = 1 - Math.pow(1 - progress, 3)
        const radius = travel * rippleRadius.value
        const temporalFade = Math.pow(1 - progress, 0.35 + rippleFade.value * 1.5)
        const headWidth = Math.max(0.12, rippleWidth.value * 0.55)
        const trailLength = Math.max(0.6, rippleWidth.value * 5.5)
        for (const source of effect.sources) {
          const rowDelta = position.row - source.row
          const columnDelta = position.column - source.column
          let distance: number
          let contribution: number
          let gradientPosition: number

          if (effect.kind === 'burst') {
            const chebyshevDistance = Math.max(Math.abs(rowDelta), Math.abs(columnDelta))
            if (chebyshevDistance > 1) continue

            const radialDistance = Math.hypot(rowDelta, columnDelta)
            const radialFalloff = Math.exp(-Math.pow(radialDistance / 1.45, 2))
            const impact = Math.exp(-Math.pow(progress / 0.62, 2))
            distance = radialDistance
            contribution = (0.38 + 0.82 * radialFalloff) * impact * temporalFade
            gradientPosition = Math.min(1, radialDistance / 1.45)
          } else {
            const isCrossRay = rowDelta === 0 || columnDelta === 0
            const isCornerRay = Math.abs(rowDelta) === Math.abs(columnDelta)
            if (effect.kind === 'cross' && !isCrossRay) continue
            if (effect.kind === 'corner' && !(isCornerRay && rowDelta !== 0)) continue
            if (effect.kind === 'rice' && !(isCrossRay || (isCornerRay && rowDelta !== 0))) continue

            distance =
              effect.kind === 'cross' ? Math.abs(rowDelta + columnDelta) : Math.abs(rowDelta)
            const distanceAttenuation = 1 / (1 + distance * 0.08)
            const head = Math.exp(-Math.pow((distance - radius) / headWidth, 2)) * 1.55
            const trail =
              distance <= radius ? Math.exp(-(radius - distance) / trailLength) * 0.85 : 0
            const impact =
              Math.exp(-Math.pow(distance / (headWidth * 2.2 + 0.7), 2)) * Math.exp(-progress * 7)
            contribution = Math.max(head, trail, impact) * temporalFade * distanceAttenuation
            const trailPosition =
              radius > 0.05 ? Math.min(1, Math.max(0, (radius - distance) / radius)) : 0
            gradientPosition = Math.pow(trailPosition, 0.7)
          }

          const effectColor = {
            red:
              effect.color.red * (1 - gradientPosition) + effect.trailColor.red * gradientPosition,
            green:
              effect.color.green * (1 - gradientPosition) +
              effect.trailColor.green * gradientPosition,
            blue:
              effect.color.blue * (1 - gradientPosition) + effect.trailColor.blue * gradientPosition
          }
          sourceIntensity += contribution
          redWeight += effectColor.red * contribution
          greenWeight += effectColor.green * contribution
          blueWeight += effectColor.blue * contribution
        }
      }

      const combinedIntensity = 1 - Math.exp(-sourceIntensity * rippleGain.value)
      if (combinedIntensity > rippleThreshold.value) {
        rayIntensities.set(note, combinedIntensity)
        rayColors.set(
          note,
          sourceIntensity > 0
            ? {
                red: redWeight / sourceIntensity,
                green: greenWeight / sourceIntensity,
                blue: blueWeight / sourceIntensity
              }
            : RIPPLE_COLORS[0]
        )
      }
    }

    const protectedNotes = new Set<number>([
      ...activeNotes.value,
      ...flashNotes.value,
      ...errorNotes.value
    ])
    const nextRippleNotes = [...rayIntensities.keys()].filter((note) => !protectedNotes.has(note))
    const nextRippleNoteSet = new Set(nextRippleNotes)
    const sentNotes = new Set(nextRippleNotes)

    const restoredNotes = [...lastRippleNotes].filter(
      (note) => !sentNotes.has(note) && !protectedNotes.has(note)
    )
    sendPadsColor(restoredNotes, playfieldBackgroundColor())

    if (sentNotes.size > 0) {
      void window.midi.setPadsRgb({
        pads: [...sentNotes].map((note) =>
          padColor(
            note,
            rippleColor(rayIntensities.get(note) ?? 0, rayColors.get(note) ?? RIPPLE_COLORS[0])
          )
        )
      })
    }

    lastRippleNotes = sentNotes
    rippleNotes.value = nextRippleNoteSet
  }

  function restoreRippleBackground(): void {
    const protectedNotes = new Set<number>([
      ...activeNotes.value,
      ...flashNotes.value,
      ...errorNotes.value
    ])
    const notes = [...lastRippleNotes].filter((note) => !protectedNotes.has(note))
    sendPadsColor(notes, playfieldBackgroundColor())
    lastRippleNotes = new Set<number>()
    rippleNotes.value = new Set<number>()
  }

  function stopRippleEffect(restoreBackground = false): void {
    if (rippleEffectTimer !== null) {
      rippleEffectTimer()
      rippleEffectTimer = null
    }

    rippleEffects = []

    if (restoreBackground) {
      restoreRippleBackground()
      return
    }
    lastRippleNotes = new Set<number>()
    rippleNotes.value = new Set<number>()
  }

  function padPosition(note: number): { row: number; column: number } {
    return { row: Math.floor(note / 10), column: (note % 10) - 1 }
  }

  function rippleColor(
    intensity: number,
    color: { red: number; green: number; blue: number }
  ): { red: number; green: number; blue: number } {
    const background = playfieldBackgroundColor()
    const shapedIntensity = intensity * (0.35 + 0.65 * intensity)
    const displayIntensity = Math.min(1, shapedIntensity * rippleBrightness.value)
    return {
      red: background.red * (1 - displayIntensity) + color.red * displayIntensity,
      green: background.green * (1 - displayIntensity) + color.green * displayIntensity,
      blue: background.blue * (1 - displayIntensity) + color.blue * displayIntensity
    }
  }

  function playfieldBackgroundColor(): { red: number; green: number; blue: number } {
    const brightness = Math.min(64, playfieldBackgroundBrightness.value)
    return { red: brightness, green: brightness, blue: brightness }
  }

  function lightStep(step: ClipStep, brightness = 1): void {
    lightNotes(getStepPadNotes(step), stepColor(step.color, brightness))
  }

  function stepColor(
    color: { red: number; green: number; blue: number },
    brightness: number
  ): { red: number; green: number; blue: number } {
    const max = Math.max(color.red, color.green, color.blue)
    if (max <= 0) return color

    const scale = (255 / max) * brightness
    return {
      red: color.red * scale,
      green: color.green * scale,
      blue: color.blue * scale
    }
  }

  function lightNotes(
    notes: readonly number[],
    color: { red: number; green: number; blue: number }
  ): void {
    sendPadsColor(notes, color)
  }

  function sendPadsColor(
    notes: readonly number[],
    color: { red: number; green: number; blue: number }
  ): void {
    if (notes.length === 0) return
    void window.midi.setPadsRgb({
      pads: notes.map((note) => padColor(note, color))
    })
  }

  function padColor(
    note: number,
    color: { red: number; green: number; blue: number }
  ): { note: number; red: number; green: number; blue: number } {
    return {
      note,
      red: clampColor(color.red),
      green: clampColor(color.green),
      blue: clampColor(color.blue)
    }
  }

  function sendOuterRingColor(color: { red: number; green: number; blue: number }): void {
    void window.midi.setPadsRgb({
      pads: OUTER_RING_NOTES.map((note) => ({ note, ...color }))
    })
  }

  function stopOuterRingEffect(): void {
    if (outerRingEffectTimer === null) return
    outerRingEffectTimer()
    outerRingEffectTimer = null
  }

  function bpmAt(timeSec: number): number {
    const projectValue = project.value
    const points = [...(projectValue?.runtimeTempoMap ?? projectValue?.tempoMap ?? [])]
      .filter((point) => point.atSec <= timeSec)
      .sort((a, b) => a.atSec - b.atSec)
    return points.at(-1)?.bpm ?? 120
  }

  function darkenNotes(notes: readonly number[]): void {
    backgroundNotes.value = new Set(
      [...backgroundNotes.value].filter((note) => !notes.includes(note))
    )
    lightNotes(notes, { red: 0, green: 0, blue: 0 })
  }

  function lightPlayfieldBackground(notes: readonly number[]): void {
    backgroundNotes.value = new Set([...backgroundNotes.value, ...notes])
    sendPadsColor(notes, playfieldBackgroundColor())
  }

  function clearLaunchpad(): void {
    void window.midi.clearLaunchpad()
  }

  function clearPromptTimers(): void {
    promptTimers.forEach((timer) => window.clearTimeout(timer))
    promptTimers = []
  }

  function clearEffectTimers(): void {
    stopOuterRingEffect()
    stopRippleEffect()
    effectTimers.forEach((timer) => window.clearTimeout(timer))
    effectTimers = []
    if (flashStepTimer !== null) {
      window.clearTimeout(flashStepTimer)
      flashStepTimer = null
    }
    activeFlashStep = null
    flashNotes.value = new Set<number>()
    errorNotes.value = new Set<number>()
  }

  function clampColor(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)))
  }

  return {
    phase: readonly(phase),
    activeNotes: readonly(activeNotes),
    backgroundNotes: readonly(backgroundNotes),
    rippleNotes: readonly(rippleNotes),
    flashNotes: readonly(flashNotes),
    errorNotes: readonly(errorNotes),
    currentRoundIndex: readonly(currentRoundIndex),
    currentStepIndex: readonly(currentStepIndex),
    result: readonly(result),
    wrongNote: readonly(wrongNote),
    expectedNote: readonly(expectedNote),
    expectedNotes: readonly(expectedNotes),
    errorCount: readonly(errorCount),
    prepare,
    start,
    startFrom,
    stop,
    pressPad,
    releasePad
  }
}
