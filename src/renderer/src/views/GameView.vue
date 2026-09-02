<script setup lang="ts">
defineEmits<{ back: [] }>()
</script>

<template>
  <div class="view-stack">
    <section class="page-heading">
      <div>
        <p class="eyebrow">Play mode / coming next</p>
        <h1>开始游戏</h1>
        <p>正式游戏页面会在这里运行：系统演示、灯光提示、玩家按键和原曲续播。</p>
      </div>
      <button class="button" @click="$emit('back')">← 返回歌曲库</button>
    </section>
    <section class="game-placeholder panel">
      <div class="game-orbit"><span></span><span></span><span></span><strong>PLAY</strong></div>
      <div>
        <span class="eyebrow">No track loaded</span>
        <h2>先从歌曲库选择一首歌</h2>
        <p>完成制谱后，现场模式会隐藏技术细节，只留下歌曲、提示和结果。</p>
        <button class="button button-primary" @click="$emit('back')">浏览歌曲库</button>
      </div>
    </section>
  </div>
</template>
