<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { TrackProject } from '../../../shared/project'
import { useAudioEngine } from '../composables/useAudioEngine'
import { useProjects } from '../composables/useProjects'

const props = defineProps<{ trackId: string | null }>()
const emit = defineEmits<{
  back: []
  trackSelected: [trackId: string]
}>()

const {
  loading,
  error,
  storageRoot,
  createTrack,
  loadProject,
  saveProject,
  loadStorageRoot,
  clearError
} = useProjects()
const {
  loading: audioLoading,
  playing,
  error: audioError,
  load: loadAudio,
  play: playAudio,
  stop: stopAudio,
  clear: clearAudio,
  clearError: clearAudioError
} = useAudioEngine()

const project = ref<TrackProject | null>(null)
const notice = ref('')
const form = reactive({
  title: '',
  artist: '',
  bpm: 120
})
const preview = reactive({
  startSec: 0,
  endSec: 0
})

const canSave = computed(
  () =>
    project.value !== null &&
    form.title.trim().length > 0 &&
    Number.isFinite(form.bpm) &&
    form.bpm > 0
)
const canPlay = computed(
  () =>
    project.value !== null &&
    !audioLoading.value &&
    project.value.durationSec > 0 &&
    Number.isFinite(preview.startSec) &&
    Number.isFinite(preview.endSec) &&
    preview.startSec >= 0 &&
    preview.endSec > preview.startSec &&
    preview.endSec <= project.value.durationSec
)

const projectDirectory = computed(() => {
  if (!project.value || !storageRoot.value) return '正在读取…'
  return `${storageRoot.value}/${project.value.id}`
})

onMounted(loadStorageRoot)
onBeforeUnmount(clearAudio)

watch(
  () => props.trackId,
  async (trackId) => {
    notice.value = ''
    clearError()
    clearAudio()
    project.value = null
    if (!trackId) return

    const loaded = await loadProject(trackId)
    if (!loaded) return
    hydrate(loaded)
    await initializeAudio(loaded)
  },
  { immediate: true }
)

async function addTrack(): Promise<void> {
  notice.value = ''
  clearError()
  clearAudio()
  const created = await createTrack()
  if (!created) return

  hydrate(created)
  emit('trackSelected', created.id)
}

async function initializeAudio(value: TrackProject): Promise<void> {
  const buffer = await loadAudio(value.id)
  if (!buffer || project.value?.id !== value.id) return

  preview.startSec = 0
  preview.endSec = Math.min(5, buffer.duration)
  if (Math.abs(value.durationSec - buffer.duration) <= 0.001) return

  const saved = await saveProject({ ...value, durationSec: buffer.duration })
  if (saved && project.value?.id === saved.id) {
    project.value = saved
    notice.value = '已读取并保存音频时长'
  }
}

async function save(): Promise<void> {
  if (!project.value || !canSave.value) return
  notice.value = ''
  clearError()

  const initialTempo = project.value.tempoMap[0]
  const tempoMap = initialTempo
    ? [{ ...initialTempo, bpm: form.bpm }, ...project.value.tempoMap.slice(1)]
    : [{ atSec: 0, bpm: form.bpm }]

  const saved = await saveProject({
    ...project.value,
    title: form.title.trim(),
    artist: form.artist.trim() || undefined,
    tempoMap
  })

  if (saved) {
    hydrate(saved)
    notice.value = '项目已保存'
  }
}

async function playPreview(): Promise<void> {
  if (!canPlay.value) return
  await playAudio(preview.startSec, preview.endSec)
}

function hydrate(value: TrackProject): void {
  project.value = value
  form.title = value.title
  form.artist = value.artist ?? ''
  form.bpm = value.tempoMap[0]?.bpm ?? 120
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
        <p class="eyebrow">Track editor / project setup</p>
        <h1>{{ project ? project.title : '制谱器' }}</h1>
        <p>先整理 Track 的基本信息。波形切片、Round 与 Pad 绑定会在下一阶段接入。</p>
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
              <p>这些信息会直接写入当前 Track 的 project.json。</p>
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
            <small>这里只修改第一个 Tempo Point；之后的变速点会由 BPM Map 编辑器管理。</small>
          </label>

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
              <dt>项目内音频</dt>
              <dd>{{ project.audioFile }}</dd>
            </div>
            <div>
              <dt>音频时长</dt>
              <dd>{{ formatDuration(project.durationSec) }}</dd>
            </div>
            <div>
              <dt>Round 数量</dt>
              <dd>{{ project.rounds.length }}</dd>
            </div>
            <div>
              <dt>Tempo Points</dt>
              <dd>{{ project.tempoMap.length }}</dd>
            </div>
          </dl>
          <div class="storage-path">
            <span>本地项目目录</span>
            <code>{{ projectDirectory }}</code>
          </div>
        </aside>
      </section>

      <section class="audio-preview panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Audio preview</p>
            <h2>区间试听</h2>
            <p>整首音频已在 Renderer 中解码；输入真实秒数试听任意区间。</p>
          </div>
          <span class="ready-badge">{{ audioLoading ? 'LOADING' : 'READY' }}</span>
        </div>

        <div class="preview-controls">
          <label class="field">
            <span>开始时间（秒）</span>
            <input
              v-model.number="preview.startSec"
              class="control"
              type="number"
              min="0"
              :max="project.durationSec"
              step="0.01"
            />
          </label>
          <label class="field">
            <span>结束时间（秒）</span>
            <input
              v-model.number="preview.endSec"
              class="control"
              type="number"
              min="0"
              :max="project.durationSec"
              step="0.01"
            />
          </label>
          <div class="preview-actions">
            <button class="button button-primary" :disabled="!canPlay" @click="playPreview">
              {{ audioLoading ? '正在解码…' : playing ? '重新播放' : '播放区间' }}
            </button>
            <button class="button" :disabled="!playing" @click="stopAudio">停止</button>
          </div>
        </div>
        <p class="preview-duration">总时长：{{ formatDuration(project.durationSec) }}</p>
      </section>
    </template>

    <section v-else class="editor-placeholder panel">
      <div class="placeholder-icon">＋</div>
      <div>
        <span class="eyebrow">No track selected</span>
        <h2>选择一首音频开始</h2>
        <p>支持 MP3、WAV、M4A、AAC、FLAC 和 OGG。选中的文件会复制进应用的 tracks 目录。</p>
        <div class="placeholder-actions">
          <button class="button button-primary" :disabled="loading" @click="addTrack">
            {{ loading ? '正在导入…' : '选择音频并新建 Track' }}
          </button>
          <button class="button" @click="emit('back')">从歌曲库选择</button>
        </div>
      </div>
    </section>
  </div>
</template>
