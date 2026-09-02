<script setup lang="ts">
defineEmits<{
  openEditor: []
  startGame: []
  openDebug: []
}>()
</script>

<template>
  <div class="view-stack">
    <section class="page-heading library-heading">
      <div>
        <p class="eyebrow">现场演示控制台</p>
        <h1>把节奏，交给你的手。</h1>
        <p>选择一首歌，跟着 Launchpad X 的灯光提示完成节拍。歌曲、谱面和音频都会在这里管理。</p>
      </div>
      <button class="button button-primary button-large" @click="$emit('openEditor')">
        ＋ 新建 Track
      </button>
    </section>

    <section class="library-toolbar">
      <div>
        <span class="eyebrow">Your tracks</span>
        <h2>歌曲库</h2>
      </div>
      <span class="count-badge">0 / 6 tracks</span>
    </section>
    <section class="track-grid">
      <article class="track-card track-card-empty">
        <div class="track-art mint-art">♪</div>
        <div class="track-card-content">
          <span class="track-status">示例卡片</span>
          <h3>你的第一首歌</h3>
          <p>导入一份 backing track，开始划分示例段和玩家段。</p>
          <button class="text-button" @click="$emit('openEditor')">打开制谱器 →</button>
        </div>
      </article>
      <article class="track-card track-card-tool">
        <div class="tool-icon">⌘</div>
        <div class="track-card-content">
          <span class="track-status">Hardware lab</span>
          <h3>Launchpad MIDI 测试台</h3>
          <p>检查端口、Note 编号和灯光效果。硬件调试时从这里开始。</p>
          <button class="text-button" @click="$emit('openDebug')">打开测试台 →</button>
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
