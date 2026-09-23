<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  STEP_HIT_EFFECTS,
  OUTER_RING_PAD_NOTES,
  getStepPadNotes,
  isPlayablePadNote,
  type ClipStep,
  type GameRound,
  type StepHitEffect,
  type TempoPoint,
  type TrackDifficulty,
  type TrackProject
} from '../../../shared/project'
import WaveformEditor from '../components/editor/WaveformEditor.vue'
import LaunchpadGrid from '../components/launchpad/LaunchpadGrid.vue'
import { useAudioEngine } from '../composables/useAudioEngine'
import { useGameEngine } from '../composables/useGameEngine'
import { useProjects } from '../composables/useProjects'

type PreviewMode = 'autoplay' | 'real'
type EditorTool = 'round' | 'note' | 'reveal' | 'tempo' | 'move'

interface ChartHistoryEntry {
  rounds: GameRound[]
  tempoMap: TempoPoint[]
  selectedRoundIndex: number
  selectedStepId: string | null
  selectedPadNotes: number[]
  selectedHitEffect: StepHitEffect
}

const UNDO_HISTORY_LIMIT = 50

const props = defineProps<{ trackId: string | null }>()
const emit = defineEmits<{
  back: []
  'track-selected': [trackId: string]
}>()

const { loading, error, storageRoot, loadProject, saveProject, loadStorageRoot, clearError } =
  useProjects()
const {
  loading: audioLoading,
  audioBuffer,
  error: audioError,
  playing: audioPlaying,
  playbackTime,
  load: loadAudio,
  play: playAudio,
  stop: stopAudio,
  seek: seekAudio,
  clear: clearAudio,
  dispose: disposeAudio,
  clearError: clearAudioError
} = useAudioEngine()

const project = ref<TrackProject | null>(null)
const notice = ref('')
const form = reactive({
  title: '',
  artist: '',
  difficulty: 'ez' as TrackDifficulty,
  bpm: 120,
  audioStartSec: 0,
  audioEndSec: null as number | null
})
const coverUrl = ref<string | null>(null)
const rounds = ref<GameRound[]>([])
const tempoMap = ref<TempoPoint[]>([])
const previewEngine = useGameEngine(project, rounds)
const previewStartSec = ref(0)
const previewMode = ref<PreviewMode>('autoplay')
const selectedRoundIndex = ref(-1)
const editorTool = ref<EditorTool>('round')
const gridDensity = ref(4)
const gridOffsetMs = ref(0)
const tempoBpm = ref(120)
const selectedPadNotes = ref<number[]>([45])
const selectedStepId = ref<string | null>(null)
const selectedHitEffect = ref<StepHitEffect>('cross')
const selectedColor = ref('#0f9f9b')
const playbackStartSec = ref(0)
const waveformEditorRef = ref<InstanceType<typeof WaveformEditor> | null>(null)
const chartHistory = ref<ChartHistoryEntry[]>([])

let waveformHistoryActive = false

const colorPalette = [
  '#0f9f9b',
  '#6cc9bd',
  '#f49b62',
  '#f2778d',
  '#7ba7d9',
  '#a9d65c',
  '#b98ad9',
  '#f5d76e'
]

const effectiveTempoMap = computed<TempoPoint[]>(() => {
  const points = tempoMap.value
    .filter(
      (point) =>
        Number.isFinite(point.atSec) &&
        point.atSec > 0.0005 &&
        Number.isFinite(point.bpm) &&
        point.bpm > 0
    )
    .map((point) => ({ ...point }))
  return [{ atSec: 0, bpm: form.bpm }, ...points].sort((a, b) => a.atSec - b.atSec)
})
const canSave = computed(
  () =>
    project.value !== null &&
    form.title.trim().length > 0 &&
    Number.isFinite(form.bpm) &&
    form.bpm > 0 &&
    effectiveTempoMap.value.every(
      (point) => Number.isFinite(point.atSec) && Number.isFinite(point.bpm) && point.bpm > 0
    ) &&
    Number.isFinite(form.audioStartSec) &&
    form.audioStartSec >= 0 &&
    (audioDuration.value <= 0 ||
      (form.audioEndSec === null
        ? form.audioStartSec < audioDuration.value
        : Number.isFinite(form.audioEndSec) &&
          form.audioEndSec > form.audioStartSec &&
          form.audioEndSec <= audioDuration.value))
)
const audioDuration = computed(() => audioBuffer.value?.duration ?? project.value?.durationSec ?? 0)
const audioPlaybackEndSec = computed(() => form.audioEndSec ?? audioDuration.value)
const selectedRound = computed(() => rounds.value[selectedRoundIndex.value] ?? null)
const sortedSteps = computed(() => {
  if (!selectedRound.value) return []
  return [...selectedRound.value.steps].sort((a, b) => a.startSec - b.startSec)
})
const selectedStep = computed(
  () => sortedSteps.value.find((step) => step.id === selectedStepId.value) ?? null
)
const activePadNotes = computed(
  () => new Set(selectedRound.value?.steps.flatMap((step) => getStepPadNotes(step)))
)
const selectedPadNoteSet = computed(() => new Set(selectedPadNotes.value))
const isPreviewActive = computed(() => previewEngine.phase.value !== 'idle')
const canUndo = computed(() => chartHistory.value.length > 0 && !isPreviewActive.value)
const canStartPreview = computed(
  () =>
    project.value !== null &&
    rounds.value.length > 0 &&
    !audioLoading.value &&
    audioDuration.value > 0 &&
    Number.isFinite(previewStartSec.value) &&
    previewStartSec.value >= 0 &&
    previewStartSec.value < audioPlaybackEndSec.value
)
const previewRound = computed(() => rounds.value[previewEngine.currentRoundIndex.value] ?? null)
const previewStep = computed(
  () => previewRound.value?.steps[previewEngine.currentStepIndex.value] ?? null
)
const previewPhaseText = computed(() => {
  switch (previewEngine.phase.value) {
    case 'loading':
      return '加载音频'
    case 'playing-track':
      return '播放原曲'
    case 'prompting':
      return '示例提示'
    case 'waiting-for-input':
      return '等待按键'
    case 'playing-clip':
      return '播放 Clip'
    case 'resuming-track':
      return '原曲续播'
    case 'failed':
      return '预览失败'
    default:
      return '待开始'
  }
})
const previewModeText = computed(() =>
  previewMode.value === 'autoplay' ? 'Autoplay 自动演示' : 'Real test 真实测试'
)

const projectDirectory = computed(() => {
  if (!project.value || !storageRoot.value) return '正在读取…'
  return `${storageRoot.value}/${project.value.id}`
})

onMounted(() => {
  void loadStorageRoot()
  window.addEventListener('keydown', handleSpacePlayback)
  window.addEventListener('keydown', handleUndoKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleSpacePlayback)
  window.removeEventListener('keydown', handleUndoKeydown)
  previewEngine.stop()
  disposeAudio()
})

watch(
  () => props.trackId,
  async (trackId) => {
    notice.value = ''
    clearError()
    previewEngine.stop()
    clearAudio()
    previewStartSec.value = 0
    playbackStartSec.value = 0
    resetChartHistory()
    project.value = null
    if (!trackId) return

    const loaded = await loadProject(trackId)
    if (!loaded) return
    hydrate(loaded)
    await initializeAudio(loaded)
  },
  { immediate: true }
)

async function initializeAudio(value: TrackProject): Promise<void> {
  const buffer = await loadAudio(value.id, true)
  if (!buffer) return

  const current = project.value
  if (!current || current.id !== value.id) return
  if (Math.abs(current.durationSec - buffer.duration) <= 0.001) return

  const saved = await saveProject({ ...current, durationSec: buffer.duration })
  if (saved && project.value?.id === saved.id) {
    project.value = saved
    notice.value = '已读取并保存音频时长'
  } else if (project.value?.id === current.id) {
    project.value = { ...current, durationSec: buffer.duration }
  }
}

async function save(): Promise<void> {
  if (!project.value || !canSave.value) return
  let nextRounds: GameRound[]
  try {
    nextRounds = validateRounds(
      rounds.value,
      audioDuration.value,
      clamp(form.audioStartSec, 0, audioPlaybackEndSec.value),
      audioPlaybackEndSec.value
    )
  } catch (cause) {
    notice.value = cause instanceof Error ? cause.message : String(cause)
    return
  }

  notice.value = ''
  clearError()

  const nextTempoMap = effectiveTempoMap.value

  const saved = await saveProject({
    ...project.value,
    title: form.title.trim(),
    artist: form.artist.trim() || undefined,
    difficulty: form.difficulty,
    audioStartSec: clamp(form.audioStartSec, 0, Math.max(0, audioDuration.value - 0.001)),
    audioEndSec:
      form.audioEndSec === null
        ? null
        : clamp(form.audioEndSec, form.audioStartSec + 0.001, audioDuration.value),
    tempoMap: nextTempoMap,
    rounds: nextRounds,
    editor: { gridOffsetMs: gridOffsetMs.value }
  })

  if (saved) {
    hydrate(saved)
    notice.value = '项目已保存'
  }
}
async function loadCover(id: string): Promise<void> {
  const result = await window.projects.readCover(id)
  if (!result.data || !result.mimeType) {
    coverUrl.value = null
    return
  }
  let binary = ''
  for (const byte of result.data) binary += String.fromCharCode(byte)
  coverUrl.value = `data:${result.mimeType};base64,${btoa(binary)}`
}

async function chooseCover(): Promise<void> {
  if (!project.value) return
  const result = await window.projects.chooseCover(project.value.id)
  if (result.project) {
    hydrate(result.project)
    notice.value = '封面已导入并保存到 Track 工程'
  } else if (result.error) {
    notice.value = result.error
  }
}

async function playRange(startSec: number, endSec: number): Promise<void> {
  if (isPreviewActive.value) return
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return
  await playAudio(startSec, endSec)
}

function getStepPlaybackEnd(round: GameRound, step: ClipStep): number {
  const steps = [...round.steps].sort((a, b) => a.startSec - b.startSec)
  const index = steps.findIndex((candidate) => candidate.id === step.id)
  const nextStep = steps[index + 1]
  return nextStep ? nextStep.startSec : round.play.endSec
}

function locatePlayback(timeSec: number): void {
  if (!Number.isFinite(timeSec) || audioDuration.value <= 0) return
  const nextStart = clamp(
    timeSec,
    form.audioStartSec,
    Math.max(form.audioStartSec, audioPlaybackEndSec.value - 0.001)
  )
  playbackStartSec.value = nextStart
  if (isPreviewActive.value) stopPreview()
  if (audioPlaying.value) stopAudio()
  seekAudio(nextStart)
}

function handleSpacePlayback(event: KeyboardEvent): void {
  if (event.code !== 'Space' || event.defaultPrevented) return

  const target = event.target
  if (
    target instanceof HTMLElement &&
    ['INPUT', 'TEXTAREA', 'SELECT', 'CONTENTEDITABLE'].includes(target.tagName)
  ) {
    return
  }

  event.preventDefault()
  toggleWaveformPlayback()
}

function toggleWaveformPlayback(): void {
  if (audioLoading.value || audioDuration.value <= 0) return
  if (isPreviewActive.value) stopPreview()

  if (audioPlaying.value) {
    stopAudio()
    seekAudio(playbackStartSec.value)
    return
  }

  const shouldFadeFromTrackStart =
    project.value !== null && Math.abs(playbackStartSec.value - form.audioStartSec) < 0.001
  if (playbackStartSec.value >= audioPlaybackEndSec.value) {
    playbackStartSec.value = form.audioStartSec
    seekAudio(playbackStartSec.value)
  }
  void playAudio(
    playbackStartSec.value,
    audioPlaybackEndSec.value,
    undefined,
    shouldFadeFromTrackStart ? { fadeInSec: 0.6, fadeOutSec: 0.6 } : { fadeOutSec: 0.6 }
  )
}

function handleUndoKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || (!event.metaKey && !event.ctrlKey)) return
  if (event.shiftKey || event.key.toLowerCase() !== 'z') return

  const target = event.target
  if (
    target instanceof HTMLElement &&
    ['INPUT', 'TEXTAREA', 'SELECT', 'CONTENTEDITABLE'].includes(target.tagName)
  ) {
    return
  }
  if (!canUndo.value) return

  event.preventDefault()
  undoChart()
}

async function startPreview(): Promise<void> {
  if (!canStartPreview.value) return

  try {
    validateRounds(
      rounds.value,
      audioDuration.value,
      clamp(form.audioStartSec, 0, audioPlaybackEndSec.value),
      audioPlaybackEndSec.value
    )
  } catch (cause) {
    notice.value = cause instanceof Error ? cause.message : String(cause)
    return
  }

  notice.value = ''
  previewStartSec.value = clamp(
    previewStartSec.value,
    form.audioStartSec,
    Math.max(form.audioStartSec, audioPlaybackEndSec.value - 0.001)
  )
  const started = await previewEngine.startFrom(previewStartSec.value, previewMode.value)
  if (!started) {
    notice.value = '这个时间点后面没有可预览的 Round'
  }
}

function stopPreview(): void {
  previewEngine.stop()
}

function handlePreviewPad(note: number): void {
  if (previewMode.value === 'real') {
    void previewEngine.pressPad(note)
  }
}

function setPreviewToSelectedRound(): void {
  if (selectedRound.value) {
    previewStartSec.value = selectedRound.value.prompt.startSec
  }
}

// 制谱器完全支持无 MIDI 硬件工作；Real test 使用下方网页 Pad 输入。
function hydrate(value: TrackProject): void {
  project.value = value
  form.title = value.title
  form.artist = value.artist ?? ''
  form.difficulty = value.difficulty ?? 'ez'
  form.bpm = value.tempoMap[0]?.bpm ?? 120
  form.audioStartSec = value.audioStartSec ?? 0
  form.audioEndSec = value.audioEndSec ?? null
  void loadCover(value.id)
  tempoBpm.value = form.bpm
  gridOffsetMs.value = Math.min(10000, Math.max(-10000, value.editor?.gridOffsetMs ?? 0))
  previewStartSec.value = form.audioStartSec
  playbackStartSec.value = form.audioStartSec
  rounds.value = value.rounds.map((round) => ({
    ...round,
    prompt: { ...round.prompt },
    play: { ...round.play },
    steps: round.steps.map((step) => ({ ...step }))
  }))
  selectedRoundIndex.value = rounds.value.length ? 0 : -1
}

function updateGridOffsetMs(value: number): void {
  gridOffsetMs.value = Math.min(10000, Math.max(-10000, Math.round(value)))
}

function updateSelectedStepId(value: string | null): void {
  selectedStepId.value = value
}

function validateRounds(
  value: GameRound[],
  durationSec: number,
  playbackStartSec: number,
  playbackEndSec: number
): GameRound[] {
  return value.map((round, roundIndex) => {
    const label = `第 ${roundIndex + 1} 个 Round`
    validateRange(round.prompt, `${label} 示例段`, durationSec)
    validateRange(round.play, `${label} 游玩段`, durationSec)
    if (
      round.prompt.startSec < playbackStartSec - 0.001 ||
      round.play.endSec > playbackEndSec + 0.001
    ) {
      throw new Error(`${label} 必须完整落在音频播放区间内`)
    }

    const promptLength = round.prompt.endSec - round.prompt.startSec
    const playLength = round.play.endSec - round.play.startSec
    if (Math.abs(promptLength - playLength) > 0.001) {
      throw new Error(`${label} 的示例段和游玩段长度必须相等`)
    }
    if (round.play.startSec < round.prompt.endSec - 0.001) {
      throw new Error(`${label} 的游玩段必须接在示例段之后`)
    }
    if (
      round.revealAtSec !== undefined &&
      (!Number.isFinite(round.revealAtSec) ||
        round.revealAtSec < round.prompt.startSec - 0.001 ||
        round.revealAtSec > round.prompt.endSec + 0.001)
    ) {
      throw new Error(`${label} 的 Reveal 事件必须落在示例段内`)
    }
    if (!round.steps.length) {
      throw new Error(`${label} 至少需要一个 Note`)
    }

    const normalizedSteps = round.steps
      .map((step, stepIndex) => {
        const pads = getStepPadNotes(step)
        validateRange(step, `${label} 的 Note ${stepIndex + 1}`, durationSec)
        if (
          step.startSec < round.play.startSec - 0.001 ||
          step.endSec > round.play.endSec + 0.001
        ) {
          throw new Error(`${label} 的 Note ${stepIndex + 1} 必须落在游玩段内`)
        }
        if (!pads.length || pads.some((note) => !isPlayablePadNote(note))) {
          throw new Error(`${label} 的 Note ${stepIndex + 1} 必须选择 6×6 内圈 Pad`)
        }
        if (new Set(pads).size !== pads.length) {
          throw new Error(`${label} 的 Note ${stepIndex + 1} 不能重复绑定同一个 Pad`)
        }

        const normalizedStep = { ...step }
        delete normalizedStep.padNote
        return {
          ...normalizedStep,
          padNotes: pads,
          id: step.id || `step-${roundIndex + 1}-${stepIndex + 1}`,
          hitEffect: step.hitEffect ?? 'cross',
          color: {
            red: Math.round(step.color.red),
            green: Math.round(step.color.green),
            blue: Math.round(step.color.blue)
          }
        }
      })
      .sort((a, b) => a.startSec - b.startSec)

    for (const [stepIndex, step] of normalizedSteps.entries()) {
      const previous = normalizedSteps[stepIndex - 1]
      if (previous && step.startSec < previous.endSec - 0.001) {
        throw new Error(`${label} 的 Note 时间不能重叠`)
      }
    }

    return {
      ...round,
      prompt: { ...round.prompt },
      play: { ...round.play },
      revealAtSec:
        round.revealAtSec === undefined
          ? undefined
          : Math.min(round.prompt.endSec, Math.max(round.prompt.startSec, round.revealAtSec)),
      steps: normalizedSteps
    }
  })
}

function validateRange(
  value: { startSec: number; endSec: number },
  label: string,
  durationSec: number
): void {
  if (
    !Number.isFinite(value.startSec) ||
    !Number.isFinite(value.endSec) ||
    value.startSec < 0 ||
    value.endSec <= value.startSec ||
    value.endSec > durationSec
  ) {
    throw new Error(`${label} 的时间范围无效`)
  }
}

function updateRounds(value: GameRound[]): void {
  if (!waveformHistoryActive) pushChartHistory()
  rounds.value = value
}

function updateTempoMap(value: TempoPoint[]): void {
  if (!waveformHistoryActive) pushChartHistory()
  tempoMap.value = normalizeTempoMap(value)
  notice.value = 'BPM 变速点已更新；后续网格间隔已重新计算'
}

function beginWaveformHistory(): void {
  if (waveformHistoryActive) return
  pushChartHistory()
  waveformHistoryActive = true
}

function endWaveformHistory(): void {
  waveformHistoryActive = false
}

function pushChartHistory(): void {
  chartHistory.value.push({
    rounds: cloneRounds(rounds.value),
    tempoMap: effectiveTempoMap.value.map((point) => ({ ...point })),
    selectedRoundIndex: selectedRoundIndex.value,
    selectedStepId: selectedStepId.value,
    selectedPadNotes: [...selectedPadNotes.value],
    selectedHitEffect: selectedHitEffect.value
  })
  if (chartHistory.value.length > UNDO_HISTORY_LIMIT) chartHistory.value.shift()
}

function resetChartHistory(): void {
  chartHistory.value = []
  waveformHistoryActive = false
}

function undoChart(): void {
  if (!canUndo.value) return
  const entry = chartHistory.value.pop()
  if (!entry) return

  rounds.value = entry.rounds
  tempoMap.value = entry.tempoMap.map((point) => ({ ...point }))
  form.bpm = entry.tempoMap[0]?.bpm ?? 120
  selectedRoundIndex.value = entry.selectedRoundIndex
  selectedStepId.value = entry.selectedStepId
  selectedPadNotes.value = [...entry.selectedPadNotes]
  selectedHitEffect.value = entry.selectedHitEffect
  notice.value = `已撤销，剩余 ${chartHistory.value.length} 步历史`
}

function cloneRounds(value: GameRound[]): GameRound[] {
  return value.map((round) => ({
    ...round,
    prompt: { ...round.prompt },
    play: { ...round.play },
    steps: round.steps.map((step) => ({
      ...step,
      padNotes: step.padNotes ? [...step.padNotes] : undefined,
      color: { ...step.color }
    }))
  }))
}

function normalizeTempoMap(value: TempoPoint[]): TempoPoint[] {
  const duration = audioDuration.value
  const sorted = value
    .filter((point) => Number.isFinite(point.atSec) && Number.isFinite(point.bpm) && point.bpm > 0)
    .map((point) => ({
      atSec: Math.round(clamp(point.atSec, 0, duration > 0 ? duration : point.atSec) * 1000) / 1000,
      bpm: Math.round(point.bpm * 100) / 100
    }))
    .sort((a, b) => a.atSec - b.atSec)

  const unique: TempoPoint[] = []
  for (const point of sorted) {
    const previous = unique.at(-1)
    if (previous && Math.abs(previous.atSec - point.atSec) < 0.0005) previous.bpm = point.bpm
    else unique.push(point)
  }
  if (!unique.length || unique[0].atSec > 0.0005) unique.unshift({ atSec: 0, bpm: form.bpm })
  else unique[0] = { atSec: 0, bpm: unique[0].bpm }
  return unique
}

function updateTempoPoint(index: number, field: 'atSec' | 'bpm', value: number): void {
  if (!Number.isFinite(value)) return
  if (index === 0) {
    if (field === 'bpm' && value > 0) form.bpm = Math.round(value * 100) / 100
    return
  }
  pushChartHistory()
  const next = effectiveTempoMap.value.map((point) => ({ ...point }))
  next[index][field] = value
  tempoMap.value = normalizeTempoMap(next)
  notice.value = 'BPM 变速点已更新；后续网格间隔已重新计算'
}

function deleteTempoPoint(index: number): void {
  if (index <= 0) return
  pushChartHistory()
  tempoMap.value = effectiveTempoMap.value.filter((_, pointIndex) => pointIndex !== index)
  notice.value = '已删除 BPM 变速点'
}

function updateSelectedRoundIndex(index: number): void {
  selectedRoundIndex.value = index
}

function updateSelectedRoundReveal(value: number | null): void {
  const round = selectedRound.value
  if (!round) return

  pushChartHistory()
  if (value === null || !Number.isFinite(value)) {
    round.revealAtSec = undefined
    notice.value = '已清除 Reveal 全亮事件，目标将在 Play 段开始时全亮'
    return
  }

  round.revealAtSec = Math.min(round.prompt.endSec, Math.max(round.prompt.startSec, value))
  notice.value = `Reveal 全亮事件已设置到 ${round.revealAtSec.toFixed(3)}s`
}

function selectRound(index: number): void {
  selectedRoundIndex.value = index
}

function selectPad(note: number, event: MouseEvent): void {
  if (!isPlayablePadNote(note)) {
    notice.value = '最外围一圈是游玩区域提示灯，不能作为 Note'
    return
  }

  const additive = event.metaKey || event.ctrlKey || event.shiftKey
  const step = selectedStep.value
  if (step) {
    pushChartHistory()
    const currentPads = getStepPadNotes(step)
    const nextPads = additive
      ? currentPads.includes(note)
        ? currentPads.filter((value) => value !== note)
        : [...currentPads, note]
      : [note]

    if (nextPads.length === 0) {
      notice.value = '选中 Note 至少要绑定一个内圈 Pad'
      return
    }

    step.padNotes = nextPads
    selectedPadNotes.value = nextPads
    notice.value = `已更新选中 Note 的 Pad：${nextPads.join(' + ')}`
    return
  }

  if (!additive) {
    selectedPadNotes.value = [note]
    return
  }

  selectedPadNotes.value = selectedPadNotes.value.includes(note)
    ? selectedPadNotes.value.filter((value) => value !== note)
    : [...selectedPadNotes.value, note]
  notice.value = selectedPadNotes.value.length
    ? `当前 Note Pad：${selectedPadNotes.value.join(' + ')}`
    : '请至少选择一个内圈 Pad'
}

function selectHitEffect(effect: StepHitEffect): void {
  const step = selectedStep.value
  if (step) {
    pushChartHistory()
    step.hitEffect = effect
    selectedHitEffect.value = effect
    notice.value = `已将选中 Note 的命中特效改为：${hitEffectLabel(effect)}`
    return
  }

  selectedHitEffect.value = effect
  notice.value = `新创建 Note 的命中特效：${hitEffectLabel(effect)}`
}

function hitEffectLabel(effect: StepHitEffect): string {
  if (effect === 'corner') return '四角射线'
  if (effect === 'burst') return '3×3 爆炸'
  if (effect === 'rice') return '米字射线'
  return '十字射线'
}

watch(selectedStepId, (stepId) => {
  const step = sortedSteps.value.find((value) => value.id === stepId)
  if (step) {
    selectedPadNotes.value = [...getStepPadNotes(step)]
    selectedHitEffect.value = step.hitEffect ?? 'cross'
  }
})

function focusRound(round: GameRound): void {
  waveformEditorRef.value?.focusRound(round)
}

function deleteRound(index: number): void {
  pushChartHistory()
  rounds.value = rounds.value.filter((_, roundIndex) => roundIndex !== index)
  if (selectedRoundIndex.value === index) {
    selectedRoundIndex.value = Math.min(index, rounds.value.length - 1)
  } else if (selectedRoundIndex.value > index) {
    selectedRoundIndex.value -= 1
  }
}

function deleteStep(stepId: string): void {
  const round = selectedRound.value
  if (!round) return
  pushChartHistory()
  round.steps = round.steps.filter((step) => step.id !== stepId)
}

function updateStepValue(step: ClipStep, field: 'startSec' | 'endSec', value: number): void {
  if (!Number.isFinite(value)) return
  pushChartHistory()
  step[field] = value
  normalizeStep(step)
}

function normalizeStep(step: ClipStep): void {
  const round = selectedRound.value
  if (!round) return
  step.startSec = clamp(step.startSec, round.play.startSec, round.play.endSec)
  step.endSec = clamp(step.endSec, round.play.startSec, round.play.endSec)
  if (!step.padNotes?.length && step.padNote !== undefined) step.padNotes = [step.padNote]
  if (step.endSec <= step.startSec) {
    step.endSec = Math.min(round.play.endSec, step.startSec + 0.01)
  }
  round.steps = [...round.steps].sort((a, b) => a.startSec - b.startSec)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function stepColor(step: ClipStep): string {
  return `rgb(${Math.round(step.color.red)}, ${Math.round(step.color.green)}, ${Math.round(step.color.blue)})`
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '待读取'
  const minutes = Math.floor(value / 60)
  const seconds = value - minutes * 60
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`
}

function formatUpdated(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}
</script>

<template>
  <div class="view-stack">
    <section class="page-heading compact-heading">
      <div>
        <p class="eyebrow">Track editor / waveform charting</p>
        <h1>{{ project ? project.title : '制谱器' }}</h1>
        <p>在波形上拖出示例段和等长游玩段，再为示例段打 Note；系统会自动镜像到游玩段。</p>
      </div>
      <div class="heading-actions">
        <button class="button" @click="emit('back')">← 返回歌曲库</button>
        <button
          v-if="project"
          class="button button-primary"
          :disabled="loading || !canSave"
          @click="save"
        >
          {{ loading ? '保存中…' : '保存项目' }}
        </button>
      </div>
    </section>

    <div v-if="error" class="notice notice-error" role="alert">
      <span>{{ error }}</span>
      <button class="text-button" @click="clearError">关闭</button>
    </div>
    <div v-if="notice" class="notice notice-success" role="status">{{ notice }}</div>
    <div v-if="audioError" class="notice notice-error" role="alert">
      <span>{{ audioError }}</span>
      <button class="text-button" @click="clearAudioError">关闭</button>
    </div>

    <section v-if="loading && !project" class="editor-loading panel">
      <span class="loading-spinner"></span>
      <p>正在加载 Track 项目…</p>
    </section>

    <template v-else-if="project">
      <section class="editor-setup-grid">
        <form class="panel project-form" @submit.prevent="save">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Metadata</p>
              <h2>基本信息</h2>
            </div>
            <span class="project-id">{{ project.id }}</span>
          </div>

          <label class="field">
            <span>TRACK 标题</span>
            <input v-model="form.title" class="control" maxlength="120" placeholder="歌曲名称" />
          </label>
          <label class="field">
            <span>艺术家 / 来源（可选）</span>
            <input v-model="form.artist" class="control" maxlength="120" placeholder="Artist" />
          </label>
          <label class="field">
            <span>难度</span>
            <select v-model="form.difficulty" class="control">
              <option value="ez">EZ · 简单</option>
              <option value="hd">HD · 困难</option>
              <option value="in">IN · 专家</option>
            </select>
          </label>
          <div class="cover-editor-field">
            <div class="cover-preview" :class="{ empty: !coverUrl }">
              <img v-if="coverUrl" :src="coverUrl" alt="歌曲封面" />
              <span v-else>♪</span>
            </div>
            <div>
              <strong>歌曲封面</strong>
              <small>创建 Track 时会自动读取同目录的同名图片、cover 或 folder 图片。</small>
              <button class="text-button" type="button" @click="chooseCover">
                上传 / 更换封面
              </button>
            </div>
          </div>
          <label class="field bpm-field">
            <span>初始 BPM</span>
            <input
              v-model.number="form.bpm"
              class="control"
              type="number"
              min="1"
              max="999"
              step="0.01"
            />
            <small>只修改第一个 Tempo Point；已有变速点会保留。</small>
          </label>
          <label class="field">
            <span>音频起始点（秒）</span>
            <input
              v-model.number="form.audioStartSec"
              class="control"
              type="number"
              min="0"
              :max="Math.max(0, audioDuration - 0.001)"
              step="0.01"
            />
            <small>正式游戏从该绝对时间开始播放；制谱预览和空格播放也会默认定位到这里。</small>
          </label>
          <label class="field">
            <span>音频终点（秒）</span>
            <input
              v-model.number="form.audioEndSec"
              class="control"
              type="number"
              min="0.01"
              :max="audioDuration"
              step="0.01"
            />
            <small>
              可点击下方按钮直接设为完整音频末尾；正式游戏和空格播放都会到这里自动淡出并结束。
            </small>
          </label>
          <button class="text-button" type="button" @click="form.audioEndSec = audioDuration">
            终点设为完整音频末尾
          </button>

          <div class="form-footer">
            <span>最后保存：{{ formatUpdated(project.updatedAt) }}</span>
            <button class="button button-primary" type="submit" :disabled="loading || !canSave">
              {{ loading ? '保存中…' : '保存基本信息' }}
            </button>
          </div>
        </form>

        <aside class="panel project-details">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Project files</p>
              <h2>项目概况</h2>
            </div>
          </div>
          <dl class="details-list">
            <div>
              <dt>源音频</dt>
              <dd>{{ project.sourceFileName }}</dd>
            </div>
            <div>
              <dt>音频时长</dt>
              <dd>{{ formatDuration(audioDuration) }}</dd>
            </div>
            <div>
              <dt>起始点</dt>
              <dd>{{ formatDuration(form.audioStartSec) }}</dd>
            </div>
            <div>
              <dt>终点</dt>
              <dd>{{ formatDuration(audioPlaybackEndSec) }}</dd>
            </div>
            <div>
              <dt>播放区间</dt>
              <dd>{{ formatDuration(audioPlaybackEndSec - form.audioStartSec) }}</dd>
            </div>
            <div>
              <dt>Round 数量</dt>
              <dd>{{ rounds.length }}</dd>
            </div>
            <div>
              <dt>BPM 变速点</dt>
              <dd>{{ effectiveTempoMap.length }}</dd>
            </div>
          </dl>
          <div class="storage-path">
            <span>本地项目目录</span>
            <code>{{ projectDirectory }}</code>
          </div>
        </aside>
      </section>

      <section class="panel chart-editor-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Playable chart</p>
            <h2>波形制谱</h2>
            <p>Round 工具拖出示例段；Note 工具在青色示例段里拖出切片，橙色游玩段会同步生成。</p>
          </div>
          <span class="ready-badge">{{ audioLoading ? 'LOADING' : 'READY' }}</span>
        </div>

        <div class="chart-toolbar">
          <div class="chart-tool-group" role="group" aria-label="制谱工具">
            <button
              class="tool-option"
              :class="{ active: editorTool === 'round' }"
              type="button"
              @click="editorTool = 'round'"
            >
              Round
            </button>
            <button
              class="tool-option"
              :class="{ active: editorTool === 'note' }"
              type="button"
              @click="editorTool = 'note'"
            >
              Note
            </button>
            <button
              class="tool-option"
              :class="{ active: editorTool === 'reveal' }"
              type="button"
              @click="editorTool = 'reveal'"
            >
              Reveal
            </button>
            <button
              class="tool-option"
              :class="{ active: editorTool === 'tempo' }"
              type="button"
              @click="editorTool = 'tempo'"
            >
              BPM
            </button>
            <button
              class="tool-option"
              :class="{ active: editorTool === 'move' }"
              type="button"
              @click="editorTool = 'move'"
            >
              Move
            </button>
          </div>

          <div class="chart-tool-group" role="group" aria-label="编辑历史">
            <button class="tool-option" type="button" :disabled="!canUndo" @click="undoChart">
              撤销 ⌘Z
            </button>
          </div>

          <label class="field density-field">
            <span>网格密度</span>
            <select v-model.number="gridDensity" class="control">
              <option :value="1">1/4 拍</option>
              <option :value="2">1/8 拍</option>
              <option :value="4">1/16 拍</option>
              <option :value="8">1/32 拍</option>
            </select>
          </label>

          <label class="field tempo-bpm-field">
            <span>新变速点 BPM</span>
            <input
              v-model.number="tempoBpm"
              class="control"
              type="number"
              min="1"
              max="999"
              step="0.01"
            />
          </label>

          <label class="field round-select-field">
            <span>当前 Round</span>
            <select
              class="control"
              :value="selectedRoundIndex"
              @change="selectRound(Number(($event.target as HTMLSelectElement).value))"
            >
              <option :value="-1" disabled>请选择 Round</option>
              <option v-for="(round, index) in rounds" :key="round.id" :value="index">
                Round {{ index + 1 }} · {{ round.steps.length }} Notes
              </option>
            </select>
          </label>

          <button class="button button-primary" :disabled="loading || !canSave" @click="save">
            {{ loading ? '保存中…' : '保存谱面' }}
          </button>
        </div>

        <div class="chart-layout">
          <div class="chart-wave-column">
            <WaveformEditor
              ref="waveformEditorRef"
              :audio-buffer="audioBuffer"
              :rounds="rounds"
              :tempo-map="effectiveTempoMap"
              :selected-round-index="selectedRoundIndex"
              :selected-pad-notes="selectedPadNotes"
              :selected-hit-effect="selectedHitEffect"
              :selected-color="selectedColor"
              :grid-density="gridDensity"
              :grid-offset-ms="gridOffsetMs"
              :tempo-bpm="tempoBpm"
              :tool="editorTool"
              :playback-time="playbackTime"
              :playback-start="playbackStartSec"
              :is-playing="audioPlaying"
              @update:rounds="updateRounds"
              @update:tempo-map="updateTempoMap"
              @update:selected-round-index="updateSelectedRoundIndex"
              @update:grid-offset-ms="updateGridOffsetMs"
              @update:selected-step-id="updateSelectedStepId"
              @play-range="playRange($event.startSec, $event.endSec)"
              @toggle-playback="toggleWaveformPlayback"
              @locate-playback="locatePlayback"
              @begin-history="beginWaveformHistory"
              @end-history="endWaveformHistory"
            />

            <section class="tempo-map-editor">
              <div class="tempo-map-heading">
                <div>
                  <strong>BPM 变速点</strong>
                  <span>选择 BPM 工具后点击波形添加；该位置后的 Grid 会按新 BPM 重新排布。</span>
                </div>
                <span>{{ effectiveTempoMap.length }} Points</span>
              </div>
              <div class="tempo-point-list">
                <div
                  v-for="(point, index) in effectiveTempoMap"
                  :key="`${point.atSec}-${index}`"
                  class="tempo-point-row"
                >
                  <strong>{{ index === 0 ? '初始' : `#${index}` }}</strong>
                  <label>
                    <span>位置（秒）</span>
                    <input
                      class="control"
                      type="number"
                      min="0"
                      :max="audioDuration"
                      step="0.001"
                      :disabled="index === 0"
                      :value="point.atSec"
                      @change="
                        updateTempoPoint(
                          index,
                          'atSec',
                          Number(($event.target as HTMLInputElement).value)
                        )
                      "
                    />
                  </label>
                  <label>
                    <span>BPM</span>
                    <input
                      class="control"
                      type="number"
                      min="1"
                      max="999"
                      step="0.01"
                      :value="point.bpm"
                      @change="
                        updateTempoPoint(
                          index,
                          'bpm',
                          Number(($event.target as HTMLInputElement).value)
                        )
                      "
                    />
                  </label>
                  <button
                    class="round-action-button danger"
                    type="button"
                    :disabled="index === 0"
                    :aria-label="index === 0 ? '初始 BPM 不能删除' : `删除 BPM 变速点 ${index}`"
                    @click="deleteTempoPoint(index)"
                  >
                    ×
                  </button>
                </div>
              </div>
            </section>

            <div class="chart-below-layout">
              <section class="side-block pad-selector-block">
                <h3>Pad 与颜色</h3>
                <p class="side-block-copy">
                  {{
                    selectedStep
                      ? `正在编辑选中 Note：${getStepPadNotes(selectedStep).join(' + ')}`
                      : '当前选择会用于新创建的 Note。'
                  }}
                </p>
                <div
                  class="chart-tool-group hit-effect-group"
                  role="group"
                  aria-label="Note 命中特效"
                >
                  <button
                    v-for="effect in STEP_HIT_EFFECTS"
                    :key="effect"
                    class="tool-option"
                    :class="{ active: selectedHitEffect === effect }"
                    type="button"
                    @click="selectHitEffect(effect)"
                  >
                    {{ hitEffectLabel(effect) }}
                  </button>
                </div>
                <LaunchpadGrid
                  :active-notes="activePadNotes"
                  :selected-notes="selectedPadNoteSet"
                  :blocked-notes="OUTER_RING_PAD_NOTES"
                  :selected-color="selectedColor"
                  compact
                  @select="selectPad"
                />
                <div class="color-palette">
                  <button
                    v-for="color in colorPalette"
                    :key="color"
                    class="color-swatch"
                    :class="{ active: color === selectedColor }"
                    :style="{ background: color }"
                    :aria-label="`选择颜色 ${color}`"
                    type="button"
                    @click="selectedColor = color"
                  ></button>
                </div>
              </section>

              <section class="side-block round-selector-block">
                <div class="side-block-heading">
                  <h3>Round 选择器</h3>
                  <span>{{ rounds.length }} 个</span>
                </div>
                <div v-if="!rounds.length" class="empty-copy">先用 Round 工具拖出一个区间。</div>
                <div v-else class="round-list">
                  <article
                    v-for="(round, index) in rounds"
                    :key="round.id"
                    class="round-card"
                    :class="{ active: index === selectedRoundIndex }"
                  >
                    <button class="round-main" type="button" @click="selectRound(index)">
                      <strong>Round {{ index + 1 }}</strong>
                      <span>{{ (round.play.endSec - round.play.startSec).toFixed(2) }}s</span>
                      <span>{{ round.steps.length }} Notes</span>
                      <span v-if="round.revealAtSec !== undefined">Reveal</span>
                    </button>
                    <div class="round-actions">
                      <button
                        class="round-action-button"
                        type="button"
                        title="聚焦 Round"
                        @click="focusRound(round)"
                      >
                        定
                      </button>
                      <button
                        class="round-action-button"
                        type="button"
                        title="试听示例段"
                        :disabled="isPreviewActive"
                        @click="playRange(round.prompt.startSec, round.prompt.endSec)"
                      >
                        例
                      </button>
                      <button
                        class="round-action-button"
                        type="button"
                        title="试听游玩段"
                        :disabled="isPreviewActive"
                        @click="playRange(round.play.startSec, round.play.endSec)"
                      >
                        玩
                      </button>
                      <button
                        class="round-action-button danger"
                        type="button"
                        title="删除 Round"
                        @click="deleteRound(index)"
                      >
                        删
                      </button>
                    </div>
                  </article>
                </div>
              </section>

              <aside class="chart-side-panel">
                <section class="side-block reveal-block">
                  <div class="side-block-heading">
                    <h3>Reveal 全亮事件</h3>
                    <span>{{ selectedRound?.revealAtSec === undefined ? '默认' : '已设置' }}</span>
                  </div>
                  <p class="side-block-copy">
                    不设置时，目标 Pad 在 Play
                    段开始才全亮；设置后，全亮和提前输入都从这个事件点开始。
                  </p>
                  <div v-if="!selectedRound" class="empty-copy">选择 Round 后可以设置 Reveal。</div>
                  <div v-else class="reveal-controls">
                    <label class="field">
                      <span>事件时间（秒）</span>
                      <input
                        :value="selectedRound.revealAtSec ?? ''"
                        class="control"
                        type="number"
                        :min="selectedRound.prompt.startSec"
                        :max="selectedRound.prompt.endSec"
                        step="0.001"
                        @change="
                          updateSelectedRoundReveal(
                            ($event.target as HTMLInputElement).value === ''
                              ? null
                              : Number(($event.target as HTMLInputElement).value)
                          )
                        "
                      />
                    </label>
                    <button
                      class="button button-small"
                      type="button"
                      :disabled="selectedRound.revealAtSec === undefined"
                      @click="updateSelectedRoundReveal(null)"
                    >
                      清除
                    </button>
                  </div>
                </section>

                <section class="side-block">
                  <div class="side-block-heading">
                    <h3>Note 列表</h3>
                    <span>{{ sortedSteps.length }} 个</span>
                  </div>
                  <div v-if="!selectedRound" class="empty-copy">选择 Round 后可以编辑 Note。</div>
                  <div v-else-if="!sortedSteps.length" class="empty-copy">
                    切到 Note 工具，在示例段上点击或拖拽创建。
                  </div>
                  <div v-else class="note-list">
                    <article
                      v-for="(step, index) in sortedSteps"
                      :key="step.id"
                      class="note-row"
                      :class="{ 'note-row-selected': step.id === selectedStepId }"
                    >
                      <span class="note-color" :style="{ background: stepColor(step) }"></span>
                      <strong>{{ index + 1 }} · Pad {{ getStepPadNotes(step).join(' + ') }}</strong>
                      <small class="note-effect-label">
                        {{ hitEffectLabel(step.hitEffect ?? 'cross') }}
                      </small>
                      <label>
                        <span>开始</span>
                        <input
                          :value="step.startSec"
                          class="control"
                          type="number"
                          :min="selectedRound.play.startSec"
                          :max="selectedRound.play.endSec"
                          step="0.001"
                          @change="
                            updateStepValue(
                              step,
                              'startSec',
                              Number(($event.target as HTMLInputElement).value)
                            )
                          "
                        />
                      </label>
                      <label>
                        <span>亮灯结束</span>
                        <input
                          :value="step.endSec"
                          class="control"
                          type="number"
                          :min="selectedRound.play.startSec"
                          :max="selectedRound.play.endSec"
                          step="0.001"
                          @change="
                            updateStepValue(
                              step,
                              'endSec',
                              Number(($event.target as HTMLInputElement).value)
                            )
                          "
                        />
                      </label>
                      <button
                        class="button button-small"
                        type="button"
                        :disabled="isPreviewActive"
                        @click="playRange(step.startSec, getStepPlaybackEnd(selectedRound, step))"
                      >
                        试听
                      </button>
                      <button
                        class="button button-small button-danger"
                        type="button"
                        @click="deleteStep(step.id)"
                      >
                        删除
                      </button>
                    </article>
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </div>
      </section>

      <section class="chart-preview-panel panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Chart preview</p>
            <h2>当前谱面预览</h2>
            <p>从任意时间点开始，先播到下一个 Round 的示例段，再按所选模式继续。</p>
          </div>
          <span
            class="ready-badge"
            :class="{ 'ready-badge-error': previewEngine.phase.value === 'failed' }"
          >
            {{ previewEngine.phase.value.toUpperCase() }}
          </span>
        </div>

        <div class="chart-preview-layout">
          <div class="chart-preview-controls">
            <div class="preview-start-row">
              <label class="field">
                <span>开始时间（秒）</span>
                <input
                  v-model.number="previewStartSec"
                  class="control"
                  type="number"
                  min="0"
                  :max="Math.max(0, audioDuration - 0.01)"
                  step="0.01"
                />
              </label>
              <button
                class="button"
                type="button"
                :disabled="!selectedRound"
                @click="setPreviewToSelectedRound"
              >
                选中 Round
              </button>
            </div>

            <div class="preview-mode-group" role="group" aria-label="预览模式">
              <button
                class="tool-option"
                :class="{ active: previewMode === 'autoplay' }"
                type="button"
                @click="previewMode = 'autoplay'"
              >
                Autoplay
              </button>
              <button
                class="tool-option"
                :class="{ active: previewMode === 'real' }"
                type="button"
                @click="previewMode = 'real'"
              >
                Real test
              </button>
            </div>

            <p class="preview-mode-copy">
              {{
                previewMode === 'autoplay'
                  ? '自动按正确顺序播放切片和灯光。'
                  : '示例结束后等待实际按键，使用界面 Pad 即可。'
              }}
            </p>

            <div class="preview-actions">
              <button
                class="button button-primary"
                :disabled="!canStartPreview || isPreviewActive"
                type="button"
                @click="startPreview"
              >
                {{ audioLoading ? '正在解码…' : '开始预览' }}
              </button>
              <button
                class="button"
                :disabled="!isPreviewActive"
                type="button"
                @click="stopPreview"
              >
                停止
              </button>
            </div>

            <dl class="preview-state-grid">
              <div>
                <dt>状态</dt>
                <dd>{{ previewPhaseText }}</dd>
              </div>
              <div>
                <dt>模式</dt>
                <dd>{{ previewModeText }}</dd>
              </div>
              <div>
                <dt>Round</dt>
                <dd>
                  {{ previewRound ? previewEngine.currentRoundIndex.value + 1 : '—' }} /
                  {{ rounds.length }}
                </dd>
              </div>
              <div>
                <dt>当前 / 期待 Pad</dt>
                <dd>{{ previewStep ? getStepPadNotes(previewStep).join(' + ') : '—' }}</dd>
              </div>
              <div>
                <dt>错误</dt>
                <dd>{{ previewEngine.errorCount.value }} / 3</dd>
              </div>
            </dl>
          </div>

          <div class="preview-pad">
            <LaunchpadGrid
              :active-notes="previewEngine.activeNotes.value"
              :flash-notes="previewEngine.flashNotes.value"
              :error-notes="previewEngine.errorNotes.value"
              compact
              @select="handlePreviewPad"
            />
          </div>
        </div>
      </section>
    </template>

    <section v-else class="editor-placeholder panel">
      <div class="placeholder-icon">♪</div>
      <div>
        <span class="eyebrow">No track selected</span>
        <h2>请先从歌曲库选择项目</h2>
        <p>新建项目请在歌曲库导入音频；导入完成后会自动进入制谱器。</p>
        <div class="placeholder-actions">
          <button class="button button-primary" @click="emit('back')">返回歌曲库</button>
        </div>
      </div>
    </section>
  </div>
</template>
