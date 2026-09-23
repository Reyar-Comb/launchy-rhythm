<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits<{ openDeveloper: [] }>()
const menuOpen = ref(false)
const selectedTrack = ref(0)
const confirmed = ref(false)
const tracks = [
  { name: 'Neon Pulse', artist: 'Kairo Studio', bpm: 126, difficulty: 'EASY' },
  { name: 'Afterglow', artist: 'Mira Vale', bpm: 138, difficulty: 'NORMAL' },
  { name: 'Circuit Breaker', artist: 'NOVA/8', bpm: 154, difficulty: 'HARD' }
]
const currentTrack = computed(() => tracks[selectedTrack.value])
const confirmLabel = computed(() =>
  confirmed.value ? `${currentTrack.value.name} · READY` : 'PRESS CONFIRM TO PLAY'
)

type Pad = { note: number; row: number; column: number }

const pads = computed<Pad[]>(() =>
  Array.from({ length: 64 }, (_, index) => {
    const row = Math.floor(index / 8)
    const column = index % 8
    return { row, column, note: (8 - row) * 10 + column + 1 }
  })
)

function isStartArea(pad: Pad): boolean {
  const x = pad.column + 1
  const y = 8 - pad.row
  return x >= 2 && x <= 7 && y >= 2 && y <= 4
}

function isUp(pad: Pad): boolean {
  return pad.row === 0 && pad.column >= 2 && pad.column <= 5
}

function isDown(pad: Pad): boolean {
  return pad.row === 7 && pad.column >= 2 && pad.column <= 5
}

function isConfirm(pad: Pad): boolean {
  return pad.row >= 6 && pad.column >= 6
}

function pressPad(pad: Pad): void {
  if (!menuOpen.value) {
    if (isStartArea(pad)) menuOpen.value = true
    return
  }
  if (isUp(pad)) selectedTrack.value = (selectedTrack.value + tracks.length - 1) % tracks.length
  if (isDown(pad)) selectedTrack.value = (selectedTrack.value + 1) % tracks.length
  if (isConfirm(pad)) confirmed.value = true
}

function selectTrack(index: number): void {
  selectedTrack.value = index
  confirmed.value = false
}

let breatheTimer: number | null = null
let unsubscribeMidi: (() => void) | null = null

async function syncHardware(): Promise<void> {
  try {
    const ports = await window.midi.getPorts()
    const input =
      ports.inputs.find((port) => port.isLaunchpadX && !port.isDawPort) ??
      ports.inputs.find((port) => port.isLaunchpadX)
    const output =
      ports.outputs.find((port) => port.isLaunchpadX && !port.isDawPort) ??
      ports.outputs.find((port) => port.isLaunchpadX)
    if (!input || !output) return
    const connection = await window.midi.connect({
      inputIndex: input.index,
      outputIndex: output.index
    })
    if (!connection.connected) return
    await window.midi.initializeLaunchpad()
    const startedAt = performance.now()
    breatheTimer = window.setInterval(() => {
      const level = 0.52 + Math.sin((performance.now() - startedAt) / (1650 / (2 * Math.PI))) * 0.28
      const menuPads = pads.value.filter((pad) => isUp(pad) || isDown(pad) || isConfirm(pad))
      void window.midi.setPadsRgb({
        pads: menuOpen.value
          ? menuPads.map((pad) => {
              const confirm = isConfirm(pad)
              return {
                note: pad.note,
                red: confirm ? 40 : 35,
                green: confirm ? 230 : 110,
                blue: confirm ? 175 : 255
              }
            })
          : pads.value
              .filter(isStartArea)
              .map((pad) => ({ note: pad.note, red: Math.round(255 * level), green: 18, blue: 28 }))
      })
    }, 70)
  } catch {
    // The visual player remains usable without a connected device.
  }
}

onMounted(() => {
  unsubscribeMidi = window.midi.onMessage((event) => {
    if (event.type !== 'Note On' || event.note === undefined) return
    const pad = pads.value.find((candidate) => candidate.note === event.note)
    if (pad) pressPad(pad)
  })
  void syncHardware()
})
onBeforeUnmount(() => {
  if (breatheTimer !== null) window.clearInterval(breatheTimer)
  unsubscribeMidi?.()
  void window.midi.clearLaunchpad()
})
</script>

<template>
  <main class="player-shell">
    <div class="player-noise"></div>
    <div class="floating-logo"><span>✦</span> LAUNCHY <em>RHYTHM</em></div>
    <button class="developer-entry" aria-label="开发者界面" @click="emit('openDeveloper')">
      ⌘
    </button>

    <section class="player-stage" :class="{ 'menu-open': menuOpen }">
      <div class="launchpad-console" :class="{ 'console-left': menuOpen }">
        <div class="real-launchpad">
          <button
            v-for="pad in pads"
            :key="pad.note"
            class="real-pad"
            :class="{
              'pad-start-area': !menuOpen && isStartArea(pad),
              'pad-menu-up': menuOpen && isUp(pad),
              'pad-menu-down': menuOpen && isDown(pad),
              'pad-menu-confirm': menuOpen && isConfirm(pad)
            }"
            :aria-label="`Pad ${pad.column + 1},${8 - pad.row}`"
            @click="pressPad(pad)"
          >
            <span></span>
          </button>
          <button v-if="!menuOpen" class="start-frame" type="button" @click="menuOpen = true">
            START
          </button>
        </div>
      </div>
      <aside v-if="menuOpen" class="track-select-panel">
        <div class="select-caption">SELECT TRACK</div>
        <div class="track-list">
          <button
            v-for="(track, index) in tracks"
            :key="track.name"
            class="track-option"
            :class="{ selected: index === selectedTrack }"
            @click="selectTrack(index)"
          >
            <span class="track-index">0{{ index + 1 }}</span>
            <span class="track-details"
              ><strong>{{ track.name }}</strong
              ><small>{{ track.artist }}</small></span
            >
            <span class="track-meta"
              ><b>{{ track.bpm }}</b
              ><small>BPM</small><em>{{ track.difficulty }}</em></span
            >
          </button>
        </div>
        <div class="track-confirm" :class="{ confirmed }">
          {{ confirmLabel }}
        </div>
      </aside>
    </section>
  </main>
</template>
