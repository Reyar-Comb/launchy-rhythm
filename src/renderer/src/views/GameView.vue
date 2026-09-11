<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TrackProject } from '../../../shared/project'
import { useProjects } from '../composables/useProjects'

const props = defineProps<{ trackId: string | null }>()
const emit = defineEmits<{ back: [] }>()
const { loading, error, loadProject, clearError } = useProjects()
const project = ref<TrackProject | null>(null)

watch(
  () => props.trackId,
  async (trackId) => {
    clearError()
    project.value = trackId ? await loadProject(trackId) : null
  },
  { immediate: true }
)
</script>

<template>
  <div class="view-stack">
    <section class="page-heading">
      <div>
        <p class="eyebrow">Play mode / coming next</p>
        <h1>{{ project ? project.title : '开始游戏' }}</h1>
        <p>正式游戏页面会在这里运行：系统演示、灯光提示、玩家按键和原曲续播。</p>
      </div>
      <button class="button" @click="emit('back')">← 返回歌曲库</button>
    </section>

    <div v-if="error" class="notice notice-error" role="alert">
      <span>{{ error }}</span>
      <button class="text-button" @click="clearError">关闭</button>
    </div>

    <section class="game-placeholder panel">
      <div class="game-orbit"><span></span><span></span><span></span><strong>PLAY</strong></div>
      <div v-if="loading">
        <span class="eyebrow">Loading project</span>
        <h2>正在读取 Track…</h2>
      </div>
      <div v-else-if="project">
        <span class="eyebrow">Track loaded · {{ project.rounds.length }} rounds</span>
        <h2>项目已接入，游戏引擎尚未开始</h2>
        <p>
          已读取 {{ project.sourceFileName }}，初始 BPM 为
          {{ project.tempoMap[0]?.bpm ?? 120 }}。阶段三完成音频引擎后即可从这里试听。
        </p>
        <button class="button button-primary" @click="emit('back')">返回继续制谱</button>
      </div>
      <div v-else>
        <span class="eyebrow">No track loaded</span>
        <h2>先从歌曲库选择一首歌</h2>
        <p>完成制谱后，现场模式会隐藏技术细节，只留下歌曲、提示和结果。</p>
        <button class="button button-primary" @click="emit('back')">浏览歌曲库</button>
      </div>
    </section>
  </div>
</template>
