<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getStepPadNotes, type TrackProject } from '../../../shared/project'
import LaunchpadGrid from '../components/launchpad/LaunchpadGrid.vue'
import { useAudioEngine } from '../composables/useAudioEngine'
import { useGameEngine } from '../composables/useGameEngine'
import { useMidiInput } from '../composables/useMidiInput'
import { useProjects } from '../composables/useProjects'

const props = defineProps<{ trackId: string | null }>()
const emit = defineEmits<{ back: [] }>()

const { loading, error, loadProject, clearError } = useProjects()
const { velocityThreshold, isNoteOnTrigger } = useMidiInput()
const {
  loading: audioLoading,
  error: audioError,
  dispose: disposeAudio,
  clearError: clearAudioError
} = useAudioEngine()

const project = ref<TrackProject | null>(null)
const game = useGameEngine(project)
const midiConnected = ref(false)
const midiStatus = ref('正在检测 Launchpad X…')

let unsubscribeMidi: (() => void) | null = null
let unsubscribeConnection: (() => void) | null = null

const currentRound = computed(() => {
  const rounds = project.value?.runtimeRounds ?? project.value?.rounds ?? []
  return rounds[game.currentRoundIndex.value] ?? null
})
const currentStep = computed(() => currentRound.value?.steps[game.currentStepIndex.value] ?? null)
const currentStepPads = computed(() =>
  currentStep.value ? getStepPadNotes(currentStep.value) : []
)
const canStart = computed(
  () =>
    project.value !== null &&
    project.value.rounds.length > 0 &&
    (game.phase.value === 'idle' || game.phase.value === 'failed') &&
    !audioLoading.value
)
const canStop = computed(() => game.phase.value !== 'idle')

const phaseText = computed(() => {
  switch (game.phase.value) {
    case 'idle':
      return game.result.value === 'success' ? '通关' : '待开始'
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
      return '失败'
    default:
      return '未知状态'
  }
})

onMounted(() => {
  unsubscribeMidi = window.midi.onMessage((event) => {
    if (isNoteOnTrigger(event)) {
      void game.pressPad(event.note)
    } else if (event.type === 'Note Off' && event.note !== undefined) {
      game.releasePad(event.note)
    }
  })
  unsubscribeConnection = window.midi.onConnection((state) => {
    midiConnected.value = state.connected
    if (state.connected) {
      midiStatus.value = `已连接 ${state.input?.name ?? 'MIDI'}`
    } else {
      midiStatus.value = state.error ?? 'Launchpad 未连接'
    }
  })
  void connectLaunchpad()
})

onBeforeUnmount(() => {
  game.stop()
  disposeAudio()
  unsubscribeMidi?.()
  unsubscribeConnection?.()
  if (midiConnected.value) void window.midi.clearLaunchpad()
})

watch(
  () => props.trackId,
  async (trackId) => {
    clearError()
    clearAudioError()
    game.stop()
    project.value = null
    if (!trackId) return

    project.value = await loadProject(trackId)
    if (project.value) await game.prepare()
  },
  { immediate: true }
)

async function connectLaunchpad(): Promise<void> {
  try {
    const ports = await window.midi.getPorts()
    if (ports.error) {
      midiStatus.value = ports.error
      return
    }

    const input =
      ports.inputs.find((port) => port.isLaunchpadX && !port.isDawPort) ??
      ports.inputs.find((port) => port.isLaunchpadX)
    const output =
      ports.outputs.find((port) => port.isLaunchpadX && !port.isDawPort) ??
      ports.outputs.find((port) => port.isLaunchpadX)

    if (!input || !output) {
      midiConnected.value = false
      midiStatus.value = '未检测到 Launchpad X；可先用界面 Pad 测试'
      return
    }

    const state = await window.midi.connect({ inputIndex: input.index, outputIndex: output.index })
    midiConnected.value = state.connected
    midiStatus.value = state.connected
      ? `已连接 ${state.input?.name ?? 'Launchpad X'}`
      : (state.error ?? 'Launchpad 连接失败')

    if (state.connected) {
      await window.midi.initializeLaunchpad()
      await window.midi.clearLaunchpad()
    }
  } catch (cause) {
    midiConnected.value = false
    midiStatus.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0:00.00'
  const minutes = Math.floor(value / 60)
  const seconds = value - minutes * 60
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`
}

function pressStep(step: TrackProject['rounds'][number]['steps'][number]): void {
  getStepPadNotes(step).forEach((note) => {
    void game.pressPad(note)
  })
}
</script>

<template>
  <div class="view-stack">
    <section class="page-heading compact-heading">
      <div>
        <p class="eyebrow">Play mode / vertical slice</p>
        <h1>{{ project ? project.title : '开始游戏' }}</h1>
        <p>示例段会依次亮出 Pad；进入玩家段后原曲静音，按对顺序即可继续。</p>
      </div>
      <div class="heading-actions">
        <button class="button" @click="emit('back')">← 返回歌曲库</button>
        <button
          class="button button-primary button-large"
          :disabled="!canStart"
          @click="game.start"
        >
          {{ game.result.value === 'success' ? '再玩一次' : '开始游戏' }}
        </button>
        <button class="button button-large" :disabled="!canStop" @click="game.stop">停止</button>
      </div>
    </section>

    <div v-if="error" class="notice notice-error" role="alert">
      <span>{{ error }}</span>
      <button class="text-button" @click="clearError">关闭</button>
    </div>
    <div v-if="audioError" class="notice notice-error" role="alert">
      <span>{{ audioError }}</span>
      <button class="text-button" @click="clearAudioError">关闭</button>
    </div>

    <section v-if="loading && !project" class="editor-loading panel">
      <span class="loading-spinner"></span>
      <p>正在读取 Track…</p>
    </section>

    <template v-else-if="project">
      <section class="game-grid">
        <aside class="panel game-status-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Game state</p>
              <h2>{{ phaseText }}</h2>
            </div>
            <span
              class="ready-badge"
              :class="{ 'ready-badge-error': game.phase.value === 'failed' }"
            >
              {{ game.phase.value.toUpperCase() }}
            </span>
          </div>

          <dl class="game-stats">
            <div>
              <dt>Round</dt>
              <dd>
                {{ Math.min(game.currentRoundIndex.value + 1, project.rounds.length) }} /
                {{ project.rounds.length }}
              </dd>
            </div>
            <div>
              <dt>Step</dt>
              <dd>
                {{ Math.min(game.currentStepIndex.value + 1, currentRound?.steps.length ?? 0) }} /
                {{ currentRound?.steps.length ?? 0 }}
              </dd>
            </div>
            <div>
              <dt>音频</dt>
              <dd>{{ audioLoading ? '解码中' : '已加载' }}</dd>
            </div>
            <div>
              <dt>错误</dt>
              <dd>{{ game.errorCount.value }} / 3</dd>
            </div>
            <div>
              <dt>Launchpad</dt>
              <dd>
                {{ midiConnected ? `已连接 · V≥${velocityThreshold}` : '界面模式' }}
              </dd>
            </div>
          </dl>

          <div class="midi-status">
            <span></span>
            {{ midiStatus }}
          </div>

          <div v-if="game.result.value === 'failed'" class="game-result game-result-failed">
            <strong>三次按错</strong>
            <p>
              最后按到 Note {{ game.wrongNote.value }}，正确的是 Note
              {{ game.expectedNotes.value.join(' + ') }}。点击“开始游戏”重试。
            </p>
          </div>
          <div v-else-if="game.result.value === 'success'" class="game-result game-result-success">
            <strong>通关！</strong>
            <p>所有 Round 都按对了，可以继续挑战或返回歌曲库。</p>
          </div>
          <div v-else class="game-result">
            <strong>
              {{
                currentStepPads.length ? `下一个：Note ${currentStepPads.join(' + ')}` : '等待开始'
              }}
            </strong>
            <p>
              {{
                currentStep
                  ? `Clip 区间 ${formatDuration(currentStep.startSec)} - ${formatDuration(currentStep.endSec)}`
                  : '点击开始游戏后先看示例提示。'
              }}
            </p>
          </div>

          <div v-if="currentRound" class="step-timeline">
            <button
              v-for="(step, index) in currentRound.steps"
              :key="step.id"
              class="step-chip"
              :class="{
                'step-done': index < game.currentStepIndex.value,
                'step-current': index === game.currentStepIndex.value
              }"
              type="button"
              @click="pressStep(step)"
            >
              <span>{{ getStepPadNotes(step).join('+') }}</span>
              <small>{{ formatDuration(step.endSec - step.startSec) }}</small>
            </button>
          </div>
        </aside>

        <section class="panel game-pad-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Input</p>
              <h2>8×8 Pad</h2>
              <p>没有硬件时点击 Pad 测试；接上 Launchpad X 后直接按实体 Pad。</p>
            </div>
            <button class="button button-small" @click="connectLaunchpad">重新连接</button>
          </div>
          <LaunchpadGrid
            :active-notes="game.activeNotes.value"
            :background-notes="game.backgroundNotes.value"
            :ripple-notes="game.rippleNotes.value"
            :flash-notes="game.flashNotes.value"
            :error-notes="game.errorNotes.value"
            :selected-note="null"
            @select="game.pressPad"
          />
        </section>
      </section>
    </template>

    <section v-else class="game-placeholder panel">
      <div class="game-orbit"><span></span><span></span><span></span><strong>PLAY</strong></div>
      <div>
        <span class="eyebrow">No track loaded</span>
        <h2>先从歌曲库选择一首歌</h2>
        <p>当前纵切片已经可以运行 Round 状态机、Clip 播放和 Launchpad 灯光反馈。</p>
        <div class="placeholder-actions">
          <button class="button button-primary" @click="emit('back')">浏览歌曲库</button>
        </div>
      </div>
    </section>
  </div>
</template>
