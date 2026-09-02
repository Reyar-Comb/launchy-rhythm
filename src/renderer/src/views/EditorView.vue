<script setup lang="ts">
defineEmits<{ back: [] }>()
</script>

<template>
  <div class="view-stack">
    <section class="page-heading">
      <div>
        <p class="eyebrow">Track editor / coming next</p>
        <h1>制谱器</h1>
        <p>这里将放置波形、示例段、玩家段和 Pad 绑定。阶段一先把页面边界和入口搭好。</p>
      </div>
      <button class="button" @click="$emit('back')">← 返回歌曲库</button>
    </section>
    <section class="editor-placeholder panel">
      <div class="placeholder-icon">⌁</div>
      <h2>准备好一首歌了吗？</h2>
      <p>下一阶段会在这里加载音频波形，并允许你点击标记任意 clip 起止位置。</p>
      <div class="placeholder-actions">
        <button class="button button-primary">选择音频（下一阶段）</button
        ><button class="button" disabled>导入项目</button>
      </div>
    </section>
    <section class="feature-grid">
      <div class="feature-card">
        <span>01</span>
        <h3>波形时间轴</h3>
        <p>点击或拖动标记，直接按秒数切分音频。</p>
      </div>
      <div class="feature-card">
        <span>02</span>
        <h3>节拍辅助</h3>
        <p>输入 BPM，让小节、半小节和 1/4 小节快速对齐。</p>
      </div>
      <div class="feature-card">
        <span>03</span>
        <h3>Pad 绑定</h3>
        <p>选择 clip 后按下实体 Pad，自动记录 Note 编号。</p>
      </div>
    </section>
  </div>
</template>
