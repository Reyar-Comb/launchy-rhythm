<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onTick, tickerStats } from '../../composables/useTicker'
import { usePlayfieldEffects } from '../../composables/usePlayfieldEffects'

const props = withDefaults(
  defineProps<{
    activeNotes?: ReadonlySet<number>
    backgroundNotes?: ReadonlySet<number>
    rippleNotes?: ReadonlySet<number>
    flashNotes?: ReadonlySet<number>
    errorNotes?: ReadonlySet<number>
    selectedNote?: number | null
    selectedNotes?: ReadonlySet<number>
    blockedNotes?: ReadonlySet<number>
    selectedColor?: string
    disabled?: boolean
    compact?: boolean
  }>(),
  {
    activeNotes: () => new Set<number>(),
    backgroundNotes: () => new Set<number>(),
    rippleNotes: () => new Set<number>(),
    flashNotes: () => new Set<number>(),
    errorNotes: () => new Set<number>(),
    selectedNote: null,
    selectedNotes: () => new Set<number>(),
    blockedNotes: () => new Set<number>(),
    selectedColor: '#0ea5a4',
    disabled: false,
    compact: false
  }
)

const emit = defineEmits<{
  select: [note: number, event: MouseEvent]
  hover: [note: number | null]
}>()

const {
  playfieldBackgroundBrightness,
  rippleDurationMs,
  rippleRadius,
  rippleWidth,
  rippleFade,
  rippleGain,
  rippleBrightness
} = usePlayfieldEffects()

const host = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const fps = ref(0)

const SIZE = 8
const GAP_RATIO = 0.075
const RADIUS_RATIO = 0.24
const HIT_MS = 260

const COLOR = {
  idleTop: '#f4f8f9',
  idleBottom: '#cfdadd',
  idleEdge: '#bccacd',
  label: '#84969b',
  lit: '#00b5a6',
  litTop: '#7ff3e4',
  litCore: '#eafffb',
  flash: '#22c55e',
  flashTop: '#c9f7d8',
  flashCore: '#f0fff6',
  error: '#ef4444',
  errorTop: '#ffd0d0',
  errorCore: '#fff0f0'
}

// note → 行列；row 0 在顶部，和 Launchpad X 物理排列一致
function cellToNote(row: number, column: number): number {
  return (8 - row) * 10 + column + 1
}

function easeOutBack(t: number): number {
  const c1 = 1.9
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

const anims = new Map<number, { hitAt: number; rippleAt: number; kind: 'ok' | 'error' }>()
let seenFlash = new Set<number>()
let seenError = new Set<number>()

let ctx: CanvasRenderingContext2D | null = null
let cssSize = 0
let padSpan = 0
let padGap = 0
let originX = 0
let originY = 0

function resize(): void {
  const element = canvas.value
  const wrapper = host.value
  if (!element || !wrapper) return

  const rect = wrapper.getBoundingClientRect()
  // 只依赖容器宽度和视口高度，避免与内容高度互相依赖
  const available = Math.max(120, Math.min(rect.width - 34, window.innerHeight * 0.62))
  const dpr = window.devicePixelRatio || 1

  cssSize = Math.round(available)
  element.style.width = `${cssSize}px`
  element.style.height = `${cssSize}px`
  element.width = Math.round(cssSize * dpr)
  element.height = Math.round(cssSize * dpr)
  ctx = element.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  padGap = cssSize * GAP_RATIO * 0.5
  padSpan = (cssSize - padGap * (SIZE + 1)) / SIZE
  originX = padGap
  originY = padGap
}

/** 引擎以 30Hz 推送 Set；这里只做状态跳变的边沿检测，动画本身在本地按帧推进。 */
function trackTransitions(now: number): void {
  for (const note of props.flashNotes) {
    if (!seenFlash.has(note)) anims.set(note, { hitAt: now, rippleAt: now, kind: 'ok' })
  }
  for (const note of seenFlash) {
    if (!props.flashNotes.has(note)) anims.delete(note)
  }
  seenFlash = new Set(props.flashNotes)

  for (const note of props.errorNotes) {
    if (!seenError.has(note)) anims.set(note, { hitAt: now, rippleAt: now, kind: 'error' })
  }
  for (const note of seenError) {
    if (!props.errorNotes.has(note)) anims.delete(note)
  }
  seenError = new Set(props.errorNotes)
}

function litTone(note: number): { fill: string; top: string; core: string } {
  if (props.errorNotes.has(note)) {
    return { fill: COLOR.error, top: COLOR.errorTop, core: COLOR.errorCore }
  }
  if (props.flashNotes.has(note)) {
    return { fill: COLOR.flash, top: COLOR.flashTop, core: COLOR.flashCore }
  }
  if (props.selectedNote === note || props.selectedNotes.has(note)) {
    return { fill: props.selectedColor, top: '#ffffff', core: '#ffffff' }
  }
  return { fill: COLOR.lit, top: COLOR.litTop, core: COLOR.litCore }
}

function drawPadBody(x: number, y: number, w: number, h: number, note: number, lit: boolean): void {
  if (!ctx) return
  const gradient = ctx.createLinearGradient(x, y, x, y + h)
  if (lit) {
    const tone = litTone(note)
    gradient.addColorStop(0, tone.top)
    gradient.addColorStop(0.55, tone.fill)
    gradient.addColorStop(1, tone.fill)
  } else {
    gradient.addColorStop(0, COLOR.idleTop)
    gradient.addColorStop(1, COLOR.idleBottom)
  }

  ctx.beginPath()
  ctx.roundRect(x, y, w, h, w * RADIUS_RATIO)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = lit ? 'rgba(255,255,255,0.9)' : COLOR.idleEdge
  ctx.stroke()
}

function drawGlow(
  x: number,
  y: number,
  w: number,
  h: number,
  note: number,
  strength: number
): void {
  if (!ctx || strength <= 0.01) return
  const cx = x + w / 2
  const cy = y + h / 2
  const tone = litTone(note)
  const radius = w * 1.5 * (0.85 + strength * 0.45)
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
  gradient.addColorStop(0, tone.fill)
  gradient.addColorStop(0.35, `${tone.fill}99`)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, strength) * 0.5 * rippleGain.value
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.restore()
}

function drawRipple(
  x: number,
  y: number,
  w: number,
  h: number,
  note: number,
  progress: number
): void {
  if (!ctx) return
  const alpha = (1 - progress) * rippleFade.value * rippleBrightness.value
  if (alpha <= 0.01) return

  const cx = x + w / 2
  const cy = y + h / 2
  const radius = w * 0.5 + easeOutCubic(progress) * w * rippleRadius.value
  const lineWidth = Math.max(1.2, w * rippleWidth.value * (1 - progress * 0.6))

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(0.9, alpha)
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = litTone(note).core
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function frame(now: number): void {
  if (!ctx) return
  ctx.clearRect(0, 0, cssSize, cssSize)
  trackTransitions(now)

  const rippleMs = Math.max(60, rippleDurationMs.value)
  const quietAlpha = Math.min(1, playfieldBackgroundBrightness.value / 64) * 0.5
  const font = `600 ${Math.round(padSpan * 0.28)}px ui-sans-serif, system-ui, sans-serif`

  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      const note = cellToNote(row, column)
      const baseX = originX + column * (padSpan + padGap)
      const baseY = originY + row * (padSpan + padGap)

      const anim = anims.get(note)
      const isActive = props.activeNotes.has(note)
      let scale = 1
      let glow = isActive ? 0.75 : 0

      if (anim) {
        const age = now - anim.hitAt
        if (age < HIT_MS) {
          const t = age / HIT_MS
          // 先涨后缩：命中瞬间胀开，再回弹到原尺寸
          const pop = easeOutBack(Math.min(1, t * 2.4))
          scale = anim.kind === 'ok' ? 1.08 - (pop - 1) * 0.16 : 1.02 - (pop - 1) * 0.1
          glow = Math.max(glow, 1 - t)
        }
      }

      const w = padSpan * scale
      const h = padSpan * (2 - scale)
      const x = baseX - (w - padSpan) / 2
      const y = baseY - (h - padSpan) / 2
      const lit = isActive || anim !== undefined

      drawGlow(x, y, w, h, note, glow)
      drawPadBody(x, y, w, h, note, lit)

      if (!lit && props.backgroundNotes.has(note) && quietAlpha > 0.01) {
        ctx.save()
        ctx.globalAlpha = quietAlpha
        ctx.beginPath()
        ctx.roundRect(
          x + padSpan * 0.18,
          y + padSpan * 0.18,
          w - padSpan * 0.36,
          h - padSpan * 0.36,
          padSpan * 0.16
        )
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.restore()
      }

      if (anim && now - anim.rippleAt < rippleMs) {
        drawRipple(x, y, w, h, note, (now - anim.rippleAt) / rippleMs)
      }

      if (props.compact) continue
      ctx.font = font
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = lit ? 'rgba(255,255,255,0.95)' : COLOR.label
      ctx.fillText(String(note), x + w / 2, y + h / 2)
    }
  }
}

function noteAt(event: PointerEvent): number | null {
  const element = canvas.value
  if (!element) return null
  const rect = element.getBoundingClientRect()
  const x = event.clientX - rect.left - originX
  const y = event.clientY - rect.top - originY
  const column = Math.floor(x / (padSpan + padGap))
  const row = Math.floor(y / (padSpan + padGap))
  if (row < 0 || row >= SIZE || column < 0 || column >= SIZE) return null
  if (x - column * (padSpan + padGap) > padSpan) return null
  if (y - row * (padSpan + padGap) > padSpan) return null
  return cellToNote(row, column)
}

function handlePointerDown(event: PointerEvent): void {
  const note = noteAt(event)
  if (note === null) return
  if (props.disabled || props.blockedNotes.has(note)) return
  emit('select', note, event as unknown as MouseEvent)
}

function handlePointerMove(event: PointerEvent): void {
  emit('hover', noteAt(event))
}

let stopTicker: (() => void) | null = null
let observer: ResizeObserver | null = null
let fpsTimer = 0

onMounted(() => {
  resize()
  observer = new ResizeObserver(resize)
  if (host.value) observer.observe(host.value)
  stopTicker = onTick(frame)
  fpsTimer = window.setInterval(() => {
    fps.value = Math.round(tickerStats.fps)
  }, 500)
})

onBeforeUnmount(() => {
  stopTicker?.()
  observer?.disconnect()
  window.clearInterval(fpsTimer)
})

const fpsLabel = computed(() => (fps.value > 0 ? `${fps.value} FPS` : 'Programmer mode'))
</script>

<template>
  <div ref="host" class="launchpad-frame" :class="{ 'launchpad-frame-compact': compact }">
    <div class="launchpad-label-row">
      <span>Launchpad X</span>
      <span>{{ fpsLabel }}</span>
    </div>
    <div class="pad-grid">
      <canvas
        ref="canvas"
        class="pad-canvas"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerleave="emit('hover', null)"
      ></canvas>
    </div>
    <div class="launchpad-led-strip"><span></span><i></i><i></i></div>
  </div>
</template>
