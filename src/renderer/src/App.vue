<script setup lang="ts">
import { onMounted, ref } from 'vue'
import EditorView from './views/EditorView.vue'
import GameView from './views/GameView.vue'
import LibraryView from './views/LibraryView.vue'
import MidiDebugView from './views/MidiDebugView.vue'
import { useMidiInput } from './composables/useMidiInput'
import { usePlayfieldEffects } from './composables/usePlayfieldEffects'
import { useProjects } from './composables/useProjects'

type ViewName = 'library' | 'editor' | 'game' | 'debug'

const currentView = ref<ViewName>('library')
const selectedTrackId = ref<string | null>(null)
const { load: loadPlayfieldEffects } = usePlayfieldEffects()
const { load: loadMidiInput } = useMidiInput()
const { tracks } = useProjects()

const navItems: Array<{ id: ViewName; label: string; caption: string }> = [
  { id: 'library', label: '歌曲库', caption: 'Tracks' },
  { id: 'editor', label: '制谱器', caption: 'Editor' },
  { id: 'game', label: '开始游戏', caption: 'Play' }
]

function navigate(view: ViewName): void {
  if (view === 'editor' && !selectedTrackId.value)
    selectedTrackId.value = tracks.value[0]?.id ?? null
  currentView.value = view
}

function openEditor(trackId?: string): void {
  const nextTrackId = trackId ?? tracks.value[0]?.id ?? null
  if (!nextTrackId) {
    currentView.value = 'library'
    return
  }
  selectedTrackId.value = nextTrackId
  currentView.value = 'editor'
}

function startGame(trackId?: string): void {
  selectedTrackId.value = trackId ?? null
  currentView.value = 'game'
}

onMounted(() => {
  void loadPlayfieldEffects()
  void loadMidiInput()
})
</script>

<template>
  <main class="app-shell min-h-screen">
    <div class="app-layout">
      <aside class="sidebar">
        <div class="brand-lockup">
          <div class="brand-mark"><span></span><span></span><span></span><span></span></div>
          <div><strong>Launchy</strong><small>RHYTHM LAB</small></div>
        </div>
        <div class="sidebar-section-label">Workspace</div>
        <nav class="main-nav" aria-label="主导航">
          <button
            v-for="item in navItems"
            :key="item.id"
            class="nav-item"
            :class="{ active: currentView === item.id }"
            @click="navigate(item.id)"
          >
            <span class="nav-dot"></span
            ><span
              ><b>{{ item.label }}</b
              ><small>{{ item.caption }}</small></span
            >
          </button>
        </nav>
        <div class="sidebar-spacer"></div>
        <button
          class="debug-link"
          :class="{ active: currentView === 'debug' }"
          @click="navigate('debug')"
        >
          <span>⌁</span><span><b>MIDI 测试台</b><small>Hardware lab</small></span>
        </button>
        <div class="sidebar-footer">
          <span class="status-dot"></span><span>Hardware optional</span
          ><small>v0.1 · Cross-platform</small>
        </div>
      </aside>
      <section class="content-area">
        <header class="content-topbar">
          <div class="breadcrumb">
            <span>LAUNCHY RHYTHM</span><i>/</i
            ><strong>{{
              currentView === 'library'
                ? '歌曲库'
                : currentView === 'editor'
                  ? '制谱器'
                  : currentView === 'game'
                    ? '开始游戏'
                    : 'MIDI 测试台'
            }}</strong>
          </div>
          <div class="topbar-actions">
            <span class="midi-chip"><span></span> Launchpad optional</span>
          </div>
        </header>
        <div class="content-scroll">
          <LibraryView
            v-if="currentView === 'library'"
            @open-editor="openEditor"
            @start-game="startGame"
            @open-debug="navigate('debug')"
          />
          <EditorView
            v-else-if="currentView === 'editor'"
            :track-id="selectedTrackId"
            @track-selected="selectedTrackId = $event"
            @back="navigate('library')"
          />
          <GameView
            v-else-if="currentView === 'game'"
            :track-id="selectedTrackId"
            @back="navigate('library')"
          />
          <MidiDebugView v-else @back="navigate('library')" />
        </div>
      </section>
    </div>
  </main>
</template>
