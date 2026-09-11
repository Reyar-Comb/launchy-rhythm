<script setup lang="ts">
import { onMounted } from 'vue'
import { useProjects } from '../composables/useProjects'

const emit = defineEmits<{
  openEditor: [trackId?: string]
  startGame: [trackId: string]
  openDebug: []
}>()

const { tracks, loading, error, refreshProjects, createTrack, clearError } = useProjects()

onMounted(refreshProjects)

async function addTrack(): Promise<void> {
  clearError()
  const project = await createTrack()
  if (project) emit('openEditor', project.id)
}

function formatDuration(seconds: number): string {
  if (!seconds) return '待读取'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
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
        <div class="track-art" :class="`track-art-${index % 4}`">
          <span>♪</span>
          <small>{{ track.bpm }} BPM</small>
        </div>
        <div class="track-card-content">
          <span class="track-status">{{ track.artist || '未填写艺术家' }}</span>
          <h3>{{ track.title }}</h3>
          <p class="track-source" :title="track.sourceFileName">{{ track.sourceFileName }}</p>
          <div class="track-meta">
            <span>{{ formatDuration(track.durationSec) }}</span>
            <span>{{ track.roundCount }} Rounds</span>
            <span>{{ formatUpdated(track.updatedAt) }}</span>
          </div>
          <div class="track-actions">
            <button class="text-button" @click="emit('openEditor', track.id)">编辑谱面 →</button>
            <button class="button button-small" @click="emit('startGame', track.id)">试玩</button>
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
          <button class="text-button" @click="emit('openDebug')">打开测试台 →</button>
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
  </div>
</template>
