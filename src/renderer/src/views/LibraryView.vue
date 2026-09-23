<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { TrackProject } from '../../../shared/project'
import { useProjects } from '../composables/useProjects'
import { useAudioEngine } from '../composables/useAudioEngine'

const emit = defineEmits<{
  'open-editor': [trackId?: string]
  'start-game': [trackId: string]
  'open-debug': []
}>()

const {
  tracks,
  loading,
  error,
  refreshProjects,
  createTrack,
  saveProject,
  deleteProject,
  clearError
} = useProjects()
const {
  loading: setupAudioLoading,
  error: setupAudioError,
  audioBuffer,
  playing: setupAudioPlaying,
  load: loadSetupAudio,
  play: playSetupAudio,
  stop: stopSetupAudio,
  dispose: disposeSetupAudio,
  clearError: clearSetupAudioError
} = useAudioEngine()

const setupProject = ref<TrackProject | null>(null)
const coverUrls = ref<Record<string, string>>({})
const setupStartSec = ref(0)
const setupEndSec = ref<number | null>(null)
onMounted(async () => {
  await refreshProjects()
  await Promise.all(tracks.value.map(loadTrackCover))
})

onBeforeUnmount(() => {
  stopSetupAudio()
  disposeSetupAudio()
})

async function addTrack(): Promise<void> {
  clearError()
  clearSetupAudioError()
  stopSetupAudio()
  const project = await createTrack()
  if (!project) return

  const buffer = await loadSetupAudio(project.id)
  const duration = buffer?.duration ?? project.durationSec
  const saved = await saveProject({
    ...project,
    audioStartSec: 0,
    audioEndSec: duration > 0 ? duration : null,
    durationSec: duration
  })

  stopSetupAudio()
  emit('open-editor', saved?.id ?? project.id)
}

const setupDurationSec = computed(
  () => audioBuffer.value?.duration ?? setupProject.value?.durationSec ?? 0
)
const canConfirmSetup = computed(
  () => setupProject.value !== null && setupDurationSec.value > 0 && !setupAudioLoading.value
)
const setupPlaybackEndSec = computed(() => setupEndSec.value ?? setupDurationSec.value)

async function previewSetupStart(): Promise<void> {
  if (!canConfirmSetup.value) return
  const duration = setupDurationSec.value
  const endSec = clamp(setupPlaybackEndSec.value, 0.01, duration)
  setupStartSec.value = clamp(setupStartSec.value, 0, Math.max(0, endSec - 0.01))
  setupEndSec.value = endSec
  await playSetupAudio(setupStartSec.value, Math.min(endSec, setupStartSec.value + 8), undefined, {
    fadeInSec: 0.6,
    fadeOutSec: 0.6
  })
}

async function finishCreateSetup(): Promise<void> {
  if (!canConfirmSetup.value || !setupProject.value) return
  const duration = setupDurationSec.value
  const endSec = clamp(setupPlaybackEndSec.value, 0.01, duration)
  const startSec = clamp(setupStartSec.value, 0, Math.max(0, endSec - 0.01))
  const saved = await saveProject({
    ...setupProject.value,
    audioStartSec: startSec,
    audioEndSec: endSec,
    durationSec: duration
  })
  if (!saved) return

  stopSetupAudio()
  setupProject.value = null
  emit('open-editor', saved.id)
}

async function skipCreateSetup(): Promise<void> {
  if (!setupProject.value) return
  const saved = await saveProject({
    ...setupProject.value,
    audioStartSec: 0,
    audioEndSec: setupDurationSec.value > 0 ? setupDurationSec.value : null,
    durationSec: setupDurationSec.value
  })
  if (!saved) return

  stopSetupAudio()
  setupProject.value = null
  emit('open-editor', saved.id)
}

function formatDuration(seconds: number): string {
  if (!seconds) return '待读取'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatUpdated(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚更新'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
async function loadTrackCover(track: { id: string; coverFile?: string }): Promise<void> {
  if (!track.coverFile) return
  const result = await window.projects.readCover(track.id)
  if (!result.data || !result.mimeType) return
  let binary = ''
  for (const byte of result.data) binary += String.fromCharCode(byte)
  coverUrls.value[track.id] = `data:${result.mimeType};base64,${btoa(binary)}`
}

function difficultyLabel(value: string): string {
  return value === 'hd' ? 'HD' : value === 'in' ? 'IN' : 'EZ'
}
async function removeTrack(trackId: string, title: string): Promise<void> {
  if (!window.confirm(`确定删除项目“${title}”？音频、封面和谱面都会被删除。`)) return
  const result = await deleteProject(trackId)
  if (result.error) return
  delete coverUrls.value[trackId]
  await refreshProjects()
}
</script>

<template>
  <div class="view-stack">
    <section class="page-heading library-heading">
      <div>
        <p class="eyebrow">现场演示控制台</p>
        <h1>把节奏，交给你的手。</h1>
        <p>选择一首歌，跟着 Launchpad X 的灯光提示完成节拍。歌曲、谱面和音频都会在这里管理。</p>
      </div>
      <button class="button button-primary button-large" :disabled="loading" @click="addTrack">
        {{ loading ? '正在处理…' : '＋ 新建 Track' }}
      </button>
    </section>

    <div v-if="error" class="notice notice-error" role="alert">
      <span>{{ error }}</span>
      <button class="text-button" @click="clearError">关闭</button>
    </div>

    <section class="library-toolbar">
      <div>
        <span class="eyebrow">Your tracks</span>
        <h2>歌曲库</h2>
      </div>
      <span class="count-badge">{{ tracks.length }} tracks</span>
    </section>

    <section class="track-grid">
      <article v-for="(track, index) in tracks" :key="track.id" class="track-card">
        <div
          class="track-art"
          :class="[`track-art-${index % 4}`, { 'track-art-cover': coverUrls[track.id] }]"
          :style="
            coverUrls[track.id] ? { backgroundImage: `url(${coverUrls[track.id]})` } : undefined
          "
        >
          <span v-if="!coverUrls[track.id]">♪</span>
          <small>{{ difficultyLabel(track.difficulty) }} · {{ track.bpm }} BPM</small>
        </div>
        <div class="track-card-content">
          <span class="track-status">{{ track.artist || '未填写艺术家' }}</span>
          <h3>{{ track.title }}</h3>
          <p class="track-source" :title="track.sourceFileName">{{ track.sourceFileName }}</p>
          <div class="track-meta">
            <span>{{ formatDuration(track.durationSec) }}</span>
            <span>
              区间 {{ formatDuration(track.audioStartSec) }} -
              {{ formatDuration(track.audioEndSec ?? track.durationSec) }}
            </span>
            <span>{{ track.roundCount }} Rounds</span>
            <span>{{ formatUpdated(track.updatedAt) }}</span>
          </div>
          <div class="track-actions">
            <button class="text-button" @click="emit('open-editor', track.id)">编辑谱面 →</button>
            <button class="button button-small" @click="emit('start-game', track.id)">试玩</button>
            <button
              class="text-button danger-text-button"
              @click="removeTrack(track.id, track.title)"
            >
              删除项目
            </button>
          </div>
        </div>
      </article>

      <article v-if="!loading && tracks.length === 0" class="track-empty panel">
        <div class="empty-track-icon">♫</div>
        <div>
          <span class="track-status">No tracks yet</span>
          <h3>从一首歌开始</h3>
          <p>选择 MP3、WAV、M4A、AAC、FLAC 或 OGG。应用会把音频复制到独立的 Track 目录。</p>
          <button class="button button-primary" @click="addTrack">选择音频</button>
        </div>
      </article>

      <article class="track-card track-card-tool">
        <div class="tool-icon">⌘</div>
        <div class="track-card-content">
          <span class="track-status">Hardware lab</span>
          <h3>Launchpad MIDI 测试台</h3>
          <p>检查端口、Note 编号和灯光效果。硬件调试时从这里开始。</p>
          <button class="text-button" @click="emit('open-debug')">打开测试台 →</button>
        </div>
      </article>
    </section>

    <section class="how-panel">
      <div>
        <span class="eyebrow">Three steps</span>
        <h2>现场流程很简单</h2>
      </div>
      <div class="steps">
        <div><b>01</b><span>选择歌曲</span><small>预加载音频和谱面</small></div>
        <div><b>02</b><span>看灯光提示</span><small>系统先演示下一段</small></div>
        <div><b>03</b><span>按对 Pad</span><small>完成后原曲继续播放</small></div>
      </div>
    </section>

    <div v-if="setupProject" class="modal-backdrop" role="presentation">
      <section
        class="start-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-setup-title"
      >
        <div class="panel-heading">
          <div>
            <p class="eyebrow">New track</p>
            <h2 id="start-setup-title">设置音频播放区间</h2>
          </div>
          <span class="count-badge">
            {{ formatDuration(setupStartSec) }} - {{ formatDuration(setupPlaybackEndSec) }}
          </span>
        </div>

        <p class="start-setup-copy">
          正式游戏只会播放这个区间，开头自动 0.6s 淡入，进入第一个 Round 前和到达终点时自动 0.6s
          淡出。
        </p>

        <div class="start-setup-fields">
          <label class="field">
            <span>起点（秒）</span>
            <input
              v-model.number="setupStartSec"
              class="control"
              type="number"
              min="0"
              :max="Math.max(0, setupDurationSec - 0.01)"
              step="0.01"
            />
          </label>
          <input
            v-model.number="setupStartSec"
            class="start-setup-slider"
            type="range"
            min="0"
            :max="Math.max(0, setupDurationSec - 0.01)"
            step="0.01"
            :disabled="!canConfirmSetup"
          />
          <label class="field">
            <span>终点（秒）</span>
            <input
              v-model.number="setupEndSec"
              class="control"
              type="number"
              min="0.01"
              :max="setupDurationSec"
              step="0.01"
            />
          </label>
          <input
            v-model.number="setupEndSec"
            class="start-setup-slider"
            type="range"
            min="0.01"
            :max="setupDurationSec"
            step="0.01"
            :disabled="!canConfirmSetup"
          />
        </div>

        <div class="start-setup-meta">
          <span>音频时长 {{ formatDuration(setupDurationSec) }}</span>
          <span>播放长度 {{ formatDuration(setupPlaybackEndSec - setupStartSec) }}</span>
          <span>{{ setupAudioLoading ? '正在解码音频…' : '音频已就绪' }}</span>
        </div>

        <div v-if="setupAudioError" class="notice notice-error" role="alert">
          <span>{{ setupAudioError }}</span>
        </div>

        <div class="start-setup-actions">
          <button class="text-button" type="button" @click="skipCreateSetup">稍后再设置</button>
          <button
            class="button"
            type="button"
            :disabled="!canConfirmSetup || setupAudioPlaying"
            @click="previewSetupStart"
          >
            {{ setupAudioLoading ? '加载中…' : '试听 8 秒' }}
          </button>
          <button
            class="button"
            type="button"
            :disabled="!setupAudioPlaying"
            @click="stopSetupAudio"
          >
            停止
          </button>
          <button
            class="button button-primary"
            type="button"
            :disabled="!canConfirmSetup"
            @click="finishCreateSetup"
          >
            保存并进入制谱器
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
