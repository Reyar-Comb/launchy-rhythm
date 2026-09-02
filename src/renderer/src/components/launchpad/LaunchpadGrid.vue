<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    activeNotes?: ReadonlySet<number>
    selectedNote?: number | null
    selectedColor?: string
    disabled?: boolean
    compact?: boolean
  }>(),
  {
    activeNotes: () => new Set<number>(),
    selectedNote: null,
    selectedColor: '#0ea5a4',
    disabled: false,
    compact: false
  }
)

const emit = defineEmits<{
  select: [note: number]
  hover: [note: number | null]
}>()

const pads = computed(() =>
  Array.from({ length: 64 }, (_, index) => {
    const row = Math.floor(index / 8)
    const column = index % 8
    return { row, column, note: (8 - row) * 10 + column + 1 }
  })
)

function padStyle(note: number): Record<string, string> {
  const active = props.activeNotes.has(note)
  const selected = props.selectedNote === note
  const color = active ? '#ffffff' : selected ? props.selectedColor : '#d9e4e7'
  return {
    '--pad-color': color,
    '--pad-glow': active || selected ? color : 'transparent'
  }
}
</script>

<template>
  <div class="launchpad-frame" :class="{ 'launchpad-frame-compact': compact }">
    <div class="launchpad-label-row">
      <span>Launchpad X</span>
      <span>Programmer mode</span>
    </div>
    <div class="pad-grid">
      <button
        v-for="pad in pads"
        :key="pad.note"
        class="pad"
        :class="{
          'pad-active': activeNotes.has(pad.note),
          'pad-selected': selectedNote === pad.note
        }"
        :style="padStyle(pad.note)"
        :disabled="disabled"
        :aria-label="`Note ${pad.note}`"
        @mouseenter="emit('hover', pad.note)"
        @mouseleave="emit('hover', null)"
        @click="emit('select', pad.note)"
      >
        <span>{{ pad.note }}</span>
      </button>
    </div>
    <div class="launchpad-led-strip"><span></span><i></i><i></i></div>
  </div>
</template>
