<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ClipStep, GameRound, StepHitEffect, TempoPoint } from '../../../../shared/project'

type EditorTool = 'round' | 'note' | 'reveal' | 'tempo' | 'move'

interface NoteHit {
  step: ClipStep
  index: number
  area: 'source' | 'play'
  edge: 'start' | 'end' | 'middle'
}

interface NoteDrag {
  pointerId: number
  stepId: string
  area: 'source' | 'play'
  edge: 'start' | 'end'
  historyPushed: boolean
}

interface GridLine {
  time: number
  level: 'subdivision' | 'beat' | 'bar'
}

const props = withDefaults(
  defineProps<{
    audioBuffer?: AudioBuffer | null
    rounds?: GameRound[]
    tempoMap?: TempoPoint[]
    selectedRoundIndex?: number
    selectedPadNotes?: number[]
    selectedHitEffect?: StepHitEffect
    selectedColor?: string
    gridDensity?: number
    gridOffsetMs?: number
    tempoBpm?: number
    tool?: EditorTool
    playbackTime?: number
    playbackStart?: number
    isPlaying?: boolean
  }>(),
  {
    audioBuffer: null,
    rounds: () => [],
    tempoMap: () => [],
    selectedRoundIndex: -1,
    selectedPadNotes: () => [11],
    selectedHitEffect: 'cross',
    selectedColor: '#0f9f9b',
    gridDensity: 4,
    gridOffsetMs: 0,
    tempoBpm: 120,
    tool: 'round',
    playbackTime: 0,
    playbackStart: 0,
    isPlaying: false
  }
)

const emit = defineEmits<{
  'update:rounds': [rounds: GameRound[]]
  'update:tempoMap': [tempoMap: TempoPoint[]]
  'update:selectedRoundIndex': [index: number]
  'update:gridOffsetMs': [value: number]
  'update:selectedStepId': [value: string | null]
  'play-range': [range: { startSec: number; endSec: number }]
  'toggle-playback': []
  'locate-playback': [timeSec: number]
  'begin-history': []
  'end-history': []
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const overviewRef = ref<HTMLDivElement | null>(null)
const localNotice = ref('')
const viewStart = ref(0)
const viewEnd = ref(0)
const selectedStepId = ref<string | null>(null)

const dragActive = ref(false)
const dragStart = ref(0)
const dragEnd = ref(0)
const overviewDrag = ref<{
  pointerId: number
  pointerStartX: number
  viewStartAtPointer: number
} | null>(null)
const noteDrag = ref<NoteDrag | null>(null)
let overviewPanTimer: number | null = null

const duration = computed(() => props.audioBuffer?.duration ?? 0)
const selectedRound = computed(() => props.rounds[props.selectedRoundIndex] ?? null)
const viewLength = computed(() => Math.max(0, viewEnd.value - viewStart.value))
const viewStartPercent = computed(() =>
  duration.value <= 0 ? 0 : (viewStart.value / duration.value) * 100
)
const viewLengthPercent = computed(() =>
  duration.value <= 0 ? 100 : (viewLength.value / duration.value) * 100
)
const gridOffsetMs = computed({
  get: () => props.gridOffsetMs,
  set: (value: number) => {
    emit('update:gridOffsetMs', clampNumber(value, -10000, 10000))
  }
})
const gridOffsetSec = computed(() => gridOffsetMs.value / 1000)

let canvasWidth = 0
let canvasHeight = 0
let resizeObserver: ResizeObserver | null = null
let peaksKey = ''
let peaks: Float32Array<ArrayBufferLike> = new Float32Array(0)

const gridLines = computed<GridLine[]>(() => {
  if (duration.value <= 0) return []
  const density = Math.max(1, Math.round(props.gridDensity))
  const offsetSec = gridOffsetSec.value
  const points = [...props.tempoMap]
    .filter((point) => Number.isFinite(point.atSec) && Number.isFinite(point.bpm) && point.bpm > 0)
    .sort((a, b) => a.atSec - b.atSec)
  const segments: TempoPoint[] = []
  for (const point of points) {
    const normalizedPoint = { atSec: Math.max(0, point.atSec), bpm: point.bpm }
    const previous = segments.at(-1)
    if (!previous || normalizedPoint.atSec > previous.atSec) segments.push(normalizedPoint)
    else previous.bpm = normalizedPoint.bpm
  }
  if (!segments.length || segments[0].atSec > 0) segments.unshift({ atSec: 0, bpm: 120 })

  const lines: GridLine[] = []
  segments.forEach((segment, segmentIndex) => {
    const segmentEnd = Math.min(duration.value, segments[segmentIndex + 1]?.atSec ?? duration.value)
    const step = 60 / segment.bpm / density
    const anchor = segment.atSec + offsetSec
    let subdivisionIndex = Math.ceil((segment.atSec - anchor) / step)
    let time = anchor + subdivisionIndex * step

    while (time < segmentEnd - 0.00001) {
      const subdivisionInBeat = ((subdivisionIndex % density) + density) % density
      const isBeat = subdivisionInBeat === 0
      const beatIndex = Math.floor(subdivisionIndex / density)
      const beatInBar = ((beatIndex % 4) + 4) % 4
      lines.push({
        time,
        level: isBeat ? (beatInBar === 0 ? 'bar' : 'beat') : 'subdivision'
      })
      time += step
      subdivisionIndex += 1
    }
  })

  return lines.sort((a, b) => a.time - b.time)
})

onMounted(() => {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container) return

  resizeObserver = new ResizeObserver(() => {
    resizeCanvas()
  })
  resizeObserver.observe(container)
  resizeCanvas()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  stopOverviewPan()
})

watch(
  () => [
    props.audioBuffer,
    props.rounds,
    props.tempoMap,
    props.gridDensity,
    props.selectedRoundIndex,
    props.selectedColor,
    props.tool,
    props.gridOffsetMs,
    props.playbackTime,
    props.isPlaying,
    selectedStepId.value,
    noteDrag.value
  ],
  () => {
    draw()
  },
  { deep: true }
)

watch(
  duration,
  (value) => {
    viewStart.value = 0
    viewEnd.value = value
    draw()
  },
  { immediate: true }
)

watch([viewStart, viewEnd], () => {
  draw()
})

watch(
  () => props.playbackTime,
  (time) => {
    if (!props.isPlaying || duration.value <= 0) return
    if (time >= viewEnd.value - viewLength.value * 0.05) {
      setViewRange(time - viewLength.value * 0.1, viewLength.value)
    } else if (time < viewStart.value) {
      setViewRange(time - viewLength.value * 0.1, viewLength.value)
    }
  }
)

watch(
  () => props.rounds,
  () => {
    if (
      selectedStepId.value &&
      !selectedRound.value?.steps.some((step) => step.id === selectedStepId.value)
    ) {
      selectedStepId.value = null
      emit('update:selectedStepId', null)
    }
  },
  { deep: true }
)

function resizeCanvas(): void {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container) return

  const rect = container.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  canvasWidth = Math.max(320, Math.floor(rect.width))
  canvasHeight = 300
  canvas.width = Math.floor(canvasWidth * ratio)
  canvas.height = Math.floor(canvasHeight * ratio)
  canvas.style.width = `${canvasWidth}px`
  canvas.style.height = `${canvasHeight}px`
  const context = canvas.getContext('2d')
  context?.scale(ratio, ratio)
  draw()
}

function draw(): void {
  const canvas = canvasRef.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return

  context.clearRect(0, 0, canvasWidth, canvasHeight)
  context.fillStyle = '#fbfdfd'
  context.fillRect(0, 0, canvasWidth, canvasHeight)

  if (duration.value <= 0) {
    context.fillStyle = '#a4b3b6'
    context.font = '13px system-ui, sans-serif'
    context.fillText('等待音频解码…', 24, 42)
    return
  }

  drawRounds(context)
  drawWaveform(context)
  drawGrid(context)
  drawRevealEvents(context)
  drawTempoPoints(context)
  drawSteps(context)
  drawDragPreview(context)
  drawTimeAxis(context)
  drawPlaybackStart(context)
  drawPlayhead(context)
}

function drawRounds(context: CanvasRenderingContext2D): void {
  props.rounds.forEach((round, index) => {
    const isSelected = index === props.selectedRoundIndex
    drawRange(
      context,
      round.prompt.startSec,
      round.prompt.endSec,
      isSelected ? '#0f9f9b' : '#78bdc5',
      0.13
    )
    drawRange(
      context,
      round.play.startSec,
      round.play.endSec,
      isSelected ? '#f49b62' : '#d8b48b',
      0.1
    )
  })
}

function drawWaveform(context: CanvasRenderingContext2D): void {
  const buffer = props.audioBuffer
  if (!buffer) return

  const key = `${viewStart.value.toFixed(4)}:${viewEnd.value.toFixed(4)}:${canvasWidth}:${buffer.duration}`
  if (key !== peaksKey) {
    peaks = buildPeaks(buffer, viewStart.value, viewEnd.value, canvasWidth)
    peaksKey = key
  }

  const centerY = canvasHeight * 0.46
  const amplitude = canvasHeight * 0.33
  context.strokeStyle = '#177f7b'
  context.lineWidth = 1
  context.beginPath()
  for (let x = 0; x < canvasWidth; x += 1) {
    const min = peaks[x * 2] ?? 0
    const max = peaks[x * 2 + 1] ?? 0
    context.moveTo(x + 0.5, centerY - max * amplitude)
    context.lineTo(x + 0.5, centerY - min * amplitude + 1)
  }
  context.stroke()

  context.strokeStyle = '#d8e7e8'
  context.beginPath()
  context.moveTo(0, centerY)
  context.lineTo(canvasWidth, centerY)
  context.stroke()
}

function buildPeaks(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  width: number
): Float32Array {
  const channel = buffer.getChannelData(0)
  const sampleStart = Math.max(0, Math.floor(startSec * buffer.sampleRate))
  const sampleEnd = Math.min(channel.length, Math.ceil(endSec * buffer.sampleRate))
  const samplesPerPixel = Math.max(1, (sampleEnd - sampleStart) / width)
  const result = new Float32Array(width * 2)

  for (let pixel = 0; pixel < width; pixel += 1) {
    const from = sampleStart + Math.floor(pixel * samplesPerPixel)
    const to = sampleStart + Math.floor((pixel + 1) * samplesPerPixel)
    let min = 1
    let max = -1
    for (let sampleIndex = from; sampleIndex < to; sampleIndex += 1) {
      const value = channel[sampleIndex] ?? 0
      if (value < min) min = value
      if (value > max) max = value
    }
    if (from >= to) {
      min = 0
      max = 0
    }
    result[pixel * 2] = min
    result[pixel * 2 + 1] = max
  }

  return result
}

function drawGrid(context: CanvasRenderingContext2D): void {
  for (const line of gridLines.value) {
    if (line.time < viewStart.value || line.time > viewEnd.value) continue
    const x = timeToX(line.time)
    context.strokeStyle =
      line.level === 'bar' ? '#6fb7b1' : line.level === 'beat' ? '#a9d4d0' : '#dcebea'
    context.lineWidth = line.level === 'bar' ? 1.5 : 1
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, canvasHeight - 27)
    context.stroke()
  }
}

function drawTempoPoints(context: CanvasRenderingContext2D): void {
  props.tempoMap.forEach((point, index) => {
    if (point.atSec < viewStart.value || point.atSec > viewEnd.value) return
    const x = timeToX(point.atSec)
    context.save()
    context.strokeStyle = index === 0 ? '#0f766e' : '#d97706'
    context.fillStyle = index === 0 ? '#0f766e' : '#d97706'
    context.lineWidth = index === 0 ? 1.5 : 2
    context.setLineDash(index === 0 ? [3, 3] : [])
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, canvasHeight - 27)
    context.stroke()
    context.setLineDash([])
    context.beginPath()
    context.moveTo(x - 6, 0)
    context.lineTo(x + 6, 0)
    context.lineTo(x, 9)
    context.closePath()
    context.fill()
    context.font = '800 10px ui-monospace, monospace'
    context.textAlign = x > canvasWidth - 72 ? 'right' : 'left'
    context.fillText(
      `${point.bpm.toFixed(2).replace(/\.00$/, '')} BPM`,
      x + (x > canvasWidth - 72 ? -9 : 9),
      14
    )
    context.restore()
  })
}

function drawRevealEvents(context: CanvasRenderingContext2D): void {
  props.rounds.forEach((round, index) => {
    if (round.revealAtSec === undefined || !Number.isFinite(round.revealAtSec)) return

    const x = timeToX(round.revealAtSec)
    if (x < -20 || x > canvasWidth + 20) return
    const isSelected = index === props.selectedRoundIndex
    const color = isSelected ? '#0284c7' : '#7dd3fc'

    context.save()
    context.strokeStyle = color
    context.lineWidth = isSelected ? 2 : 1
    context.beginPath()
    context.moveTo(x, 11)
    context.lineTo(x, canvasHeight - 27)
    context.stroke()

    context.fillStyle = color
    context.beginPath()
    context.moveTo(x, 9)
    context.lineTo(x + 7, 18)
    context.lineTo(x, 27)
    context.lineTo(x - 7, 18)
    context.closePath()
    context.fill()

    if (isSelected) {
      context.font = '800 10px system-ui, sans-serif'
      context.textAlign = x > canvasWidth - 72 ? 'right' : 'left'
      context.fillText('REVEAL', x + (x > canvasWidth - 72 ? -10 : 10), 21)
    }
    context.restore()
  })
}

function drawSteps(context: CanvasRenderingContext2D): void {
  const round = selectedRound.value
  if (!round) return

  round.steps.forEach((step, index) => {
    const sourceStart = round.prompt.startSec + (step.startSec - round.play.startSec)
    const isSelected = step.id === selectedStepId.value
    drawClipBlock(
      context,
      sourceStart,
      sourceEnd(round, step),
      stepToCss(step.color, 0.45),
      stepToCss(step.color, 1),
      index + 1,
      true,
      isSelected
    )
    drawClipBlock(
      context,
      step.startSec,
      step.endSec,
      stepToCss(step.color, 0.65),
      stepToCss(step.color, 1),
      index + 1,
      false,
      isSelected
    )
  })
}

function sourceEnd(round: GameRound, step: ClipStep): number {
  return round.prompt.startSec + (step.endSec - round.play.startSec)
}

function drawClipBlock(
  context: CanvasRenderingContext2D,
  startSec: number,
  endSec: number,
  fillColor: string,
  strokeColor: string,
  label: number,
  isSource: boolean,
  isSelected = false
): void {
  const x1 = timeToX(startSec)
  const x2 = timeToX(endSec)
  const width = Math.max(2, x2 - x1)
  const y = isSource ? canvasHeight - 86 : canvasHeight - 57
  const height = 21
  context.fillStyle = fillColor
  context.strokeStyle = strokeColor
  context.lineWidth = 1
  if (isSelected) {
    context.lineWidth = 2
    context.strokeStyle = '#173042'
  }
  context.beginPath()
  context.roundRect(x1, y, width, height, 5)
  context.fill()
  context.stroke()

  if (width > 20) {
    context.fillStyle = '#173042'
    context.font = '700 10px ui-monospace, monospace'
    context.fillText(String(label), x1 + 5, y + 14)
  }
}

function drawDragPreview(context: CanvasRenderingContext2D): void {
  if (!dragActive.value) return
  const start = Math.min(dragStart.value, dragEnd.value)
  const end = Math.max(dragStart.value, dragEnd.value)
  const color = props.tool === 'round' ? '#0f9f9b' : '#f49b62'
  drawRange(context, start, end, color, 0.18)

  context.strokeStyle = color
  context.setLineDash([4, 3])
  context.beginPath()
  context.moveTo(timeToX(start), 0)
  context.lineTo(timeToX(start), canvasHeight - 27)
  context.moveTo(timeToX(end), 0)
  context.lineTo(timeToX(end), canvasHeight - 27)
  context.stroke()
  context.setLineDash([])

  context.fillStyle = color
  context.font = '700 11px system-ui, sans-serif'
  context.fillText(`${start.toFixed(2)}s - ${end.toFixed(2)}s`, timeToX(start) + 5, 20)
}

function drawTimeAxis(context: CanvasRenderingContext2D): void {
  context.fillStyle = '#f7fafa'
  context.fillRect(0, canvasHeight - 27, canvasWidth, 27)
  context.strokeStyle = '#dbe7e8'
  context.beginPath()
  context.moveTo(0, canvasHeight - 27)
  context.lineTo(canvasWidth, canvasHeight - 27)
  context.stroke()

  const targetLabels = 10
  const rawStep = viewLength.value / targetLabels
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const candidates = [1, 2, 5, 10].map((value) => value * power)
  const labelStep = candidates.find((value) => value >= rawStep) ?? power * 10
  const first = Math.ceil(viewStart.value / labelStep) * labelStep

  context.fillStyle = '#70848d'
  context.font = '700 10px ui-monospace, monospace'
  for (let time = first; time <= viewEnd.value; time += labelStep) {
    const x = timeToX(time)
    context.strokeStyle = '#c9dcdd'
    context.beginPath()
    context.moveTo(x, canvasHeight - 27)
    context.lineTo(x, canvasHeight - 20)
    context.stroke()
    context.fillText(
      formatAxisTime(time),
      Math.min(canvasWidth - 34, Math.max(3, x - 15)),
      canvasHeight - 7
    )
  }
}

function drawPlayhead(context: CanvasRenderingContext2D): void {
  const time = props.playbackTime
  if (time < viewStart.value || time > viewEnd.value) return

  const x = timeToX(time)
  context.strokeStyle = '#0f766e'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(x, 0)
  context.lineTo(x, canvasHeight - 27)
  context.stroke()

  context.fillStyle = '#0f766e'
  context.beginPath()
  context.moveTo(x - 6, 0)
  context.lineTo(x + 6, 0)
  context.lineTo(x, 9)
  context.closePath()
  context.fill()
}

function drawPlaybackStart(context: CanvasRenderingContext2D): void {
  const time = props.playbackStart
  if (time < viewStart.value || time > viewEnd.value) return

  const x = timeToX(time)
  context.save()
  context.strokeStyle = '#f08c2e'
  context.lineWidth = 2
  context.setLineDash([5, 4])
  context.beginPath()
  context.moveTo(x, 0)
  context.lineTo(x, canvasHeight - 27)
  context.stroke()
  context.restore()
}

function drawRange(
  context: CanvasRenderingContext2D,
  startSec: number,
  endSec: number,
  color: string,
  alpha: number
): void {
  if (endSec <= startSec) return
  const x1 = timeToX(startSec)
  const x2 = timeToX(endSec)
  if (x2 < 0 || x1 > canvasWidth) return

  context.globalAlpha = alpha
  context.fillStyle = color
  context.fillRect(x1, 0, x2 - x1, canvasHeight - 27)
  context.globalAlpha = 1
}

function onPointerDown(event: PointerEvent): void {
  if (duration.value <= 0) return
  if (event.button !== 0) return
  const rawTime = Math.min(duration.value, Math.max(0, pointerTime(event)))
  const time = props.tool === 'tempo' ? rawTime : snapToGrid(rawTime)
  if (props.tool === 'move') {
    emit('locate-playback', time)
    localNotice.value = `播放起点已定位到 ${time.toFixed(3)}s`
    return
  }
  if (props.tool === 'tempo') {
    createTempoPoint(time)
    return
  }
  if (props.tool === 'reveal') {
    setRevealAt(time)
    return
  }
  if (props.tool === 'note') {
    const hit = findNoteHit(event)
    if (hit) {
      if (selectedStepId.value !== hit.step.id) {
        localNotice.value = '右键选中 Note 后，可拖动前后边缘伸缩；再右键一次删除。'
        draw()
        return
      }

      if (hit.edge === 'middle') {
        localNotice.value = '拖动 Note 前后 8px 左右的边缘可以伸缩'
        return
      }

      noteDrag.value = {
        pointerId: event.pointerId,
        stepId: hit.step.id,
        area: hit.area,
        edge: hit.edge,
        historyPushed: false
      }
      canvasRef.value?.setPointerCapture(event.pointerId)
      draw()
      return
    }

    const round = selectedRound.value
    if (!round) {
      localNotice.value = '先选择一个 Round，再添加 Note'
      return
    }
    if (time < round.prompt.startSec || time > round.prompt.endSec) {
      localNotice.value = 'Note 只能在青色示例段内创建'
      return
    }
  }

  localNotice.value = ''
  dragActive.value = true
  dragStart.value = time
  dragEnd.value = time
  canvasRef.value?.setPointerCapture(event.pointerId)
  draw()
}

function onPointerMove(event: PointerEvent): void {
  const drag = noteDrag.value
  if (drag) {
    if (drag.pointerId !== event.pointerId) return
    if (!drag.historyPushed) {
      emit('begin-history')
      drag.historyPushed = true
    }
    dragNoteEdge(drag, snapToGrid(pointerTime(event)))
    draw()
    return
  }

  if (!dragActive.value) return
  let time = snapToGrid(pointerTime(event))
  const round = selectedRound.value
  if (props.tool === 'note' && round) {
    time = Math.min(round.prompt.endSec, Math.max(round.prompt.startSec, time))
  }
  dragEnd.value = time
  draw()
}

function onPointerUp(event: PointerEvent): void {
  if (noteDrag.value?.pointerId === event.pointerId) {
    if (noteDrag.value.historyPushed) emit('end-history')
    noteDrag.value = null
    localNotice.value = 'Note 时间已更新'
    draw()
    return
  }

  if (!dragActive.value) return
  dragActive.value = false
  const start = Math.min(dragStart.value, dragEnd.value)
  const end = Math.max(dragStart.value, dragEnd.value)

  if (props.tool === 'round') {
    createRound(start, end)
  } else {
    createNote(start, end)
  }
  draw()
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()

  const hit = props.tool === 'note' ? findNoteHit(event) : null
  if (!hit) {
    const roundIndex = findRoundHit(event)
    if (roundIndex < 0) return

    selectedStepId.value = null
    emit('update:selectedStepId', null)
    emit('update:selectedRoundIndex', roundIndex)
    localNotice.value = `已选中 Round ${roundIndex + 1}`
    draw()
    return
  }

  if (selectedStepId.value !== hit.step.id) {
    selectedStepId.value = hit.step.id
    emit('update:selectedStepId', hit.step.id)
    localNotice.value = '已选中 Note，再右键一次删除'
    draw()
    return
  }

  const round = selectedRound.value
  if (!round) return
  emit('begin-history')
  updateRound({ ...round, steps: round.steps.filter((step) => step.id !== hit.step.id) })
  emit('end-history')
  selectedStepId.value = null
  emit('update:selectedStepId', null)
  localNotice.value = '已删除 Note'
}

function findRoundHit(event: MouseEvent): number {
  const time = pointerTime(event)
  return props.rounds.findIndex(
    (round) =>
      (time >= round.prompt.startSec && time <= round.prompt.endSec) ||
      (time >= round.play.startSec && time <= round.play.endSec)
  )
}

function createRound(start: number, end: number): void {
  let promptStart = Math.max(0, start)
  let promptEnd = Math.min(duration.value, end)
  if (promptEnd - promptStart < 0.01) {
    const bpm = bpmAt(promptStart)
    promptEnd = Math.min(duration.value, promptStart + 240 / bpm)
  }
  const length = promptEnd - promptStart
  const playStart = promptEnd
  const playEnd = playStart + length

  if (length <= 0 || playEnd > duration.value + 0.001) {
    localNotice.value = '示例段后面空间不足，无法生成等长游玩段'
    return
  }

  const round: GameRound = {
    id: `round-${Date.now()}`,
    prompt: { startSec: promptStart, endSec: promptEnd },
    play: { startSec: playStart, endSec: playEnd },
    // 不设置 Reveal 时，Play taps 默认在 Play 段开始才全亮。
    steps: []
  }
  emit('begin-history')
  emit('update:rounds', [...props.rounds, round])
  emit('update:selectedRoundIndex', props.rounds.length)
  emit('end-history')
  localNotice.value = `已创建 Round：示例 ${promptStart.toFixed(2)}s - ${promptEnd.toFixed(2)}s，游玩等长`
}

function setRevealAt(time: number): void {
  const round = selectedRound.value
  if (!round) {
    localNotice.value = '先选择一个 Round，再设置 Reveal 事件'
    return
  }
  if (time < round.prompt.startSec || time > round.prompt.endSec) {
    localNotice.value = 'Reveal 事件只能设置在当前 Round 的青色示例段内'
    return
  }

  emit('begin-history')
  updateRound({ ...round, revealAtSec: time })
  emit('end-history')
  localNotice.value = `Reveal 全亮事件已设置到 ${time.toFixed(3)}s`
}

function createTempoPoint(time: number): void {
  if (!Number.isFinite(props.tempoBpm) || props.tempoBpm <= 0) {
    localNotice.value = '请先输入有效的新 BPM'
    return
  }
  if (time <= 0.0005) {
    localNotice.value = '0 秒位置是初始 BPM，请在基本信息中修改'
    return
  }

  const point = {
    atSec: Math.round(time * 1000) / 1000,
    bpm: Math.round(props.tempoBpm * 100) / 100
  }
  const next = props.tempoMap
    .filter((value) => Math.abs(value.atSec - point.atSec) >= 0.0005)
    .map((value) => ({ ...value }))
  next.push(point)
  next.sort((a, b) => a.atSec - b.atSec)
  emit('begin-history')
  emit('update:tempoMap', next)
  emit('end-history')
  localNotice.value = `已在 ${point.atSec.toFixed(3)}s 设置 ${point.bpm} BPM；后续 Grid 已更新`
}

function createNote(start: number, end: number): void {
  const round = selectedRound.value
  if (!round) return

  const sourceStart = Math.min(round.prompt.endSec, Math.max(round.prompt.startSec, start))
  let sourceEnd = Math.min(round.prompt.endSec, Math.max(round.prompt.startSec, end))
  if (sourceEnd - sourceStart < 0.01) {
    sourceEnd = Math.min(round.prompt.endSec, sourceStart + gridStepAt(sourceStart))
  }

  const relativeStart = sourceStart - round.prompt.startSec
  const relativeEnd = sourceEnd - round.prompt.startSec
  const step: ClipStep = {
    id: `step-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    startSec: round.play.startSec + relativeStart,
    endSec: round.play.startSec + relativeEnd,
    padNotes: [...props.selectedPadNotes],
    color: cssToRgb(props.selectedColor),
    hitEffect: props.selectedHitEffect
  }

  const steps = [...round.steps, step].sort((a, b) => a.startSec - b.startSec)
  emit('begin-history')
  updateRound({ ...round, steps })
  emit('end-history')
  localNotice.value = `已创建 Note ${(step.padNotes ?? []).join(' + ')}，并镜像到游玩段`
}

function updateRound(round: GameRound): void {
  const rounds = props.rounds.map((value, index) =>
    index === props.selectedRoundIndex ? round : value
  )
  emit('update:rounds', rounds)
}

function findNoteHit(event: MouseEvent): NoteHit | null {
  const round = selectedRound.value
  const canvas = canvasRef.value
  if (!round || !canvas) return null

  const rect = canvas.getBoundingClientRect()
  const y = event.clientY - rect.top
  const time = pointerTime(event)
  const steps = [...round.steps].sort((a, b) => a.startSec - b.startSec)

  for (const [index, step] of steps.entries()) {
    const areas: Array<'source' | 'play'> = ['source', 'play']
    for (const area of areas) {
      const start =
        area === 'source'
          ? round.prompt.startSec + (step.startSec - round.play.startSec)
          : step.startSec
      const end = area === 'source' ? sourceEnd(round, step) : step.endSec
      const yStart = area === 'source' ? canvasHeight - 86 : canvasHeight - 57
      if (y < yStart || y > yStart + 21) continue
      if (time < start - 0.0001 || time > end + 0.0001) continue

      const startDistance = Math.abs(timeToX(time) - timeToX(start))
      const endDistance = Math.abs(timeToX(time) - timeToX(end))
      const edge: NoteHit['edge'] =
        startDistance <= 8 ? 'start' : endDistance <= 8 ? 'end' : 'middle'
      return { step, index, area, edge }
    }
  }

  return null
}

function dragNoteEdge(drag: NoteDrag, rawTime: number): void {
  const round = selectedRound.value
  if (!round) return

  const steps = [...round.steps].sort((a, b) => a.startSec - b.startSec)
  const stepIndex = steps.findIndex((step) => step.id === drag.stepId)
  const step = steps[stepIndex]
  if (!step) return

  const previous = steps.slice(0, stepIndex).at(-1)
  const next = steps[stepIndex + 1]
  const areaStart = drag.area === 'source' ? round.prompt.startSec : round.play.startSec
  const areaEnd = drag.area === 'source' ? round.prompt.endSec : round.play.endSec
  let time = Math.min(areaEnd, Math.max(areaStart, rawTime))

  if (drag.edge === 'start') {
    const currentEnd = drag.area === 'source' ? sourceEnd(round, step) : step.endSec
    const earliest = previous
      ? drag.area === 'source'
        ? round.prompt.startSec + (previous.endSec - round.play.startSec)
        : previous.endSec
      : areaStart
    time = Math.min(currentEnd - 0.01, Math.max(earliest, time))
  } else {
    const currentStart =
      drag.area === 'source'
        ? round.prompt.startSec + (step.startSec - round.play.startSec)
        : step.startSec
    const latest = next
      ? drag.area === 'source'
        ? round.prompt.startSec + (next.startSec - round.play.startSec)
        : next.startSec
      : areaEnd
    time = Math.max(currentStart + 0.01, Math.min(latest, time))
  }

  const nextStep = { ...step }
  if (drag.area === 'source') {
    const relative = time - round.prompt.startSec
    if (drag.edge === 'start') nextStep.startSec = round.play.startSec + relative
    else nextStep.endSec = round.play.startSec + relative
  } else if (drag.edge === 'start') {
    nextStep.startSec = time
  } else {
    nextStep.endSec = time
  }

  updateRound({
    ...round,
    steps: steps.map((value) => (value.id === nextStep.id ? nextStep : value))
  })
}

function snapToGrid(time: number): number {
  const lines = gridLines.value
  if (!lines.length) return time
  let low = 0
  let high = lines.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (lines[middle].time < time) low = middle + 1
    else high = middle
  }

  const current = lines[low]
  const previous = lines[low - 1]
  if (!previous) return current.time
  return Math.abs(current.time - time) < Math.abs(time - previous.time)
    ? current.time
    : previous.time
}

function gridStepAt(time: number): number {
  const bpm = bpmAt(time)
  return 60 / bpm / Math.max(1, props.gridDensity)
}

function bpmAt(time: number): number {
  const points = [...props.tempoMap]
    .filter((point) => point.atSec <= time)
    .sort((a, b) => a.atSec - b.atSec)
  return points.at(-1)?.bpm ?? 120
}

function pointerTime(event: { clientX: number }): number {
  const canvas = canvasRef.value
  if (!canvas) return 0
  const rect = canvas.getBoundingClientRect()
  const ratio = (event.clientX - rect.left) / rect.width
  return viewStart.value + ratio * viewLength.value
}

function timeToX(time: number): number {
  if (viewLength.value <= 0) return 0
  return ((time - viewStart.value) / viewLength.value) * canvasWidth
}

function zoom(factor: number): void {
  if (duration.value <= 0) return
  const center = (viewStart.value + viewEnd.value) / 2
  zoomAtRatio(0.5, factor, center)
}

function fitAll(): void {
  viewStart.value = 0
  viewEnd.value = duration.value
}

function focusRound(round: GameRound): void {
  const length = round.play.endSec - round.prompt.startSec
  const padding = Math.max(0.5, length * 0.12)
  viewStart.value = Math.max(0, round.prompt.startSec - padding)
  viewEnd.value = Math.min(duration.value, round.play.endSec + padding)
}

function zoomAtRatio(
  ratio: number,
  factor: number,
  focusTime = viewStart.value + ratio * viewLength.value
): void {
  if (duration.value <= 0) return
  let length = Math.min(duration.value, Math.max(1, viewLength.value * factor))
  let start = focusTime - ratio * length
  if (start < 0) start = 0
  if (start + length > duration.value) start = duration.value - length
  viewStart.value = start
  viewEnd.value = start + length
}

function onOverviewPointerDown(event: PointerEvent): void {
  if (duration.value <= 0 || event.button !== 0) return

  const ratio = overviewPointerRatio(event)
  const clickedTime = ratio * duration.value
  const length = viewLength.value
  if (clickedTime < viewStart.value || clickedTime > viewEnd.value) {
    setViewRange(clickedTime - length / 2, length)
  }

  overviewDrag.value = {
    pointerId: event.pointerId,
    pointerStartX: event.clientX,
    viewStartAtPointer: viewStart.value
  }
  const target = event.currentTarget
  if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId)
}

function onOverviewPointerMove(event: PointerEvent): void {
  const dragState = overviewDrag.value
  const overview = overviewRef.value
  if (!dragState || dragState.pointerId !== event.pointerId || !overview) return

  const rect = overview.getBoundingClientRect()
  const deltaRatio = (event.clientX - dragState.pointerStartX) / Math.max(1, rect.width)
  setViewRange(dragState.viewStartAtPointer + deltaRatio * duration.value, viewLength.value)
}

function onOverviewPointerUp(event: PointerEvent): void {
  if (overviewDrag.value?.pointerId !== event.pointerId) return
  overviewDrag.value = null
}

function overviewPointerRatio(event: { clientX: number }): number {
  const overview = overviewRef.value
  if (!overview || duration.value <= 0) return 0
  const rect = overview.getBoundingClientRect()
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
}

function setViewRange(start: number, length: number): void {
  if (duration.value <= 0) return
  const safeLength = Math.min(duration.value, Math.max(0.05, length))
  const safeStart = Math.min(duration.value - safeLength, Math.max(0, start))
  viewStart.value = safeStart
  viewEnd.value = safeStart + safeLength
}

function startOverviewPan(direction: -1 | 1): void {
  stopOverviewPan()
  panView(direction)
  overviewPanTimer = window.setInterval(() => panView(direction), 50)
}

function stopOverviewPan(): void {
  if (overviewPanTimer === null) return
  window.clearInterval(overviewPanTimer)
  overviewPanTimer = null
}

function panView(direction: -1 | 1): void {
  if (duration.value <= 0) return
  const delta = viewLength.value * 0.01
  setViewRange(viewStart.value + direction * delta, viewLength.value)
}

function nudgeGrid(deltaMs: number): void {
  gridOffsetMs.value = clampNumber(gridOffsetMs.value + deltaMs, -10000, 10000)
}

function resetGrid(): void {
  gridOffsetMs.value = 0
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(max, Math.max(min, value))
}

function rangePercent(value: number): string {
  return `${duration.value <= 0 ? 0 : (value / duration.value) * 100}%`
}

function formatAxisTime(value: number): string {
  if (value < 60) return `${value.toFixed(1)}s`
  const minutes = Math.floor(value / 60)
  const seconds = value - minutes * 60
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
}

function cssToRgb(value: string): { red: number; green: number; blue: number } {
  const normalized = value.replace('#', '')
  const number = Number.parseInt(normalized, 16)
  return {
    red: (number >> 16) & 255,
    green: (number >> 8) & 255,
    blue: number & 255
  }
}

function stepToCss(color: { red: number; green: number; blue: number }, alpha = 1): string {
  const red = Math.round(color.red)
  const green = Math.round(color.green)
  const blue = Math.round(color.blue)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

defineExpose({
  focusRound
})
</script>

<template>
  <div class="waveform-editor">
    <div class="waveform-toolbar">
      <div class="waveform-view-info">
        <strong>{{ viewStart.toFixed(2) }}s – {{ viewEnd.toFixed(2) }}s</strong>
        <span>
          起点 {{ playbackStart.toFixed(2) }}s · 播放 {{ playbackTime.toFixed(2) }}s /
          {{ duration.toFixed(2) }}s · 空格播放/回到起点 · 进度条拖拽平移
        </span>
      </div>
      <div class="waveform-view-tools">
        <div class="waveform-view-actions">
          <button
            class="button button-small"
            :class="{ 'button-primary': isPlaying }"
            type="button"
            @click="emit('toggle-playback')"
          >
            {{ isPlaying ? '暂停' : '播放' }}
          </button>
          <button class="button button-small" type="button" @click="zoom(0.6)">放大</button>
          <button class="button button-small" type="button" @click="zoom(1.65)">缩小</button>
          <button class="button button-small" type="button" @click="fitAll">整首</button>
        </div>
        <div class="waveform-edit-grid">
          <div class="edit-grid-title">
            <span>Edit Grid</span>
            <strong>{{ gridOffsetMs }}ms</strong>
          </div>
          <div class="edit-grid-controls">
            <button type="button" @click="nudgeGrid(-10)">-10</button>
            <button type="button" @click="nudgeGrid(-1)">-1</button>
            <input
              v-model.number="gridOffsetMs"
              type="number"
              step="1"
              min="-10000"
              max="10000"
              aria-label="Grid offset milliseconds"
              @change="gridOffsetMs = clampNumber(gridOffsetMs, -10000, 10000)"
            />
            <button type="button" @click="nudgeGrid(1)">+1</button>
            <button type="button" @click="nudgeGrid(10)">+10</button>
            <button type="button" @click="resetGrid">Reset</button>
          </div>
        </div>
      </div>
    </div>

    <div ref="containerRef" class="waveform-container">
      <canvas
        ref="canvasRef"
        :class="{
          'cursor-round': tool === 'round',
          'cursor-note': tool === 'note',
          'cursor-reveal': tool === 'reveal',
          'cursor-tempo': tool === 'tempo',
          'cursor-move': tool === 'move'
        }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @contextmenu="onContextMenu"
      ></canvas>
    </div>

    <div class="waveform-overview-outer">
      <button
        class="overview-pan-button"
        type="button"
        aria-label="向左移动时间轴"
        @pointerdown.prevent="startOverviewPan(-1)"
        @pointerup="stopOverviewPan"
        @pointerleave="stopOverviewPan"
        @pointercancel="stopOverviewPan"
        @contextmenu.prevent
      >
        ←
      </button>
      <div
        ref="overviewRef"
        class="waveform-overview"
        @pointerdown="onOverviewPointerDown"
        @pointermove="onOverviewPointerMove"
        @pointerup="onOverviewPointerUp"
        @pointercancel="onOverviewPointerUp"
      >
        <div
          v-for="(round, index) in rounds"
          :key="round.id"
          class="overview-round"
          :class="{ active: index === selectedRoundIndex }"
        >
          <i
            class="overview-prompt"
            :style="{
              left: rangePercent(round.prompt.startSec),
              width: rangePercent(round.prompt.endSec - round.prompt.startSec)
            }"
          ></i>
          <i
            class="overview-play"
            :style="{
              left: rangePercent(round.play.startSec),
              width: rangePercent(round.play.endSec - round.play.startSec)
            }"
          ></i>
        </div>
        <div
          class="overview-viewport"
          :style="{
            left: `${viewStartPercent}%`,
            width: `${viewLengthPercent}%`
          }"
        >
          <span></span>
        </div>
        <div
          class="overview-playhead"
          :style="{ left: rangePercent(playbackTime) }"
          :class="{ active: isPlaying }"
        ></div>
      </div>
      <button
        class="overview-pan-button"
        type="button"
        aria-label="向右移动时间轴"
        @pointerdown.prevent="startOverviewPan(1)"
        @pointerup="stopOverviewPan"
        @pointerleave="stopOverviewPan"
        @pointercancel="stopOverviewPan"
        @contextmenu.prevent
      >
        →
      </button>
    </div>

    <div class="waveform-legend">
      <span><i class="legend-prompt"></i>示例段</span>
      <span><i class="legend-play"></i>游玩段</span>
      <span><i class="legend-source-note"></i>示例段 Note</span>
      <span><i class="legend-play-note"></i>镜像 Note</span>
      <span><i class="legend-tempo"></i>BPM 变速点</span>
    </div>
    <p v-if="localNotice" class="waveform-notice">{{ localNotice }}</p>
  </div>
</template>
