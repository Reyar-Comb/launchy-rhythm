<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import LaunchpadGrid from '../components/launchpad/LaunchpadGrid.vue'
import type {
  MidiConnectionState,
  MidiMessageEvent,
  MidiPortInfo,
  MidiPortsResult
} from '../../../shared/midi'

type PadMode = 'steady' | 'flash' | 'pulse'

const ports = ref<MidiPortsResult>({ inputs: [], outputs: [] })
const selectedInput = ref<number | null>(null)
const selectedOutput = ref<number | null>(null)
const connection = ref<MidiConnectionState>({ connected: false })
const messages = ref<MidiMessageEvent[]>([])
const activeNotes = ref(new Set<number>())
const selectedNote = ref(81)
const selectedColor = ref('#0ea5a4')
const selectedMode = ref<PadMode>('steady')
const paletteColor = ref(21)
const manualMessage = ref('144,81,127')
const hoveredNote = ref<number | null>(null)
const statusText = ref('正在检查 MIDI 端口…')
const isRefreshing = ref(false)
const maxMessages = 80
let removeMessageListener: (() => void) | undefined
let removeConnectionListener: (() => void) | undefined

function portLabel(port: MidiPortInfo): string {
  const tags = [port.isLaunchpadX ? 'Launchpad X' : '', port.isDawPort ? 'DAW' : '']
    .filter(Boolean)
    .join(' · ')
  return tags ? `${port.name} (${tags})` : port.name
}

function colorToRgb(hex: string): { red: number; green: number; blue: number } {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return { red: (value >> 16) & 0xff, green: (value >> 8) & 0xff, blue: value & 0xff }
}

async function refreshPorts(): Promise<void> {
  isRefreshing.value = true
  const result = await window.midi.getPorts()
  ports.value = result
  isRefreshing.value = false
  const input = result.inputs.find((port) => port.isLaunchpadX && !port.isDawPort)
  const output = result.outputs.find((port) => port.isLaunchpadX && !port.isDawPort)
  selectedInput.value = input?.index ?? result.inputs[0]?.index ?? null
  selectedOutput.value = output?.index ?? result.outputs[0]?.index ?? null
  statusText.value = result.error
    ? `MIDI 初始化失败：${result.error}`
    : `${result.inputs.length} 个输入端口 · ${result.outputs.length} 个输出端口`
}

async function connect(): Promise<void> {
  if (selectedInput.value === null || selectedOutput.value === null) {
    statusText.value = '请先选择输入和输出端口'
    return
  }
  const state = await window.midi.connect({
    inputIndex: selectedInput.value,
    outputIndex: selectedOutput.value
  })
  connection.value = state
  statusText.value = state.connected
    ? `已连接：${state.input?.name} → ${state.output?.name}`
    : `连接失败：${state.error ?? '未知错误'}`
  if (state.connected) {
    const result = await window.midi.initializeLaunchpad()
    if (!result.ok) statusText.value = `已连接，但初始化 Launchpad 失败：${result.error}`
  }
}

async function disconnect(): Promise<void> {
  connection.value = await window.midi.disconnect()
  activeNotes.value = new Set()
  statusText.value = '已断开 MIDI 连接'
}

async function initializeLaunchpad(): Promise<void> {
  const result = await window.midi.initializeLaunchpad()
  statusText.value = result.ok
    ? '已发送 Programmer Mode + Programmer Layout'
    : `发送失败：${result.error}`
}

async function clearLaunchpad(): Promise<void> {
  const result = await window.midi.clearLaunchpad()
  activeNotes.value = new Set()
  statusText.value = result.ok ? '已清除 Launchpad 网格灯光' : `清灯失败：${result.error}`
}

async function sendPad(note: number): Promise<void> {
  selectedNote.value = note
  const result = await window.midi.setPadRgb({ note, ...colorToRgb(selectedColor.value) })
  statusText.value = result.ok ? `已发送 RGB 到 Note ${note}` : `发送失败：${result.error}`
}

async function sendSelectedPalette(): Promise<void> {
  const result = await window.midi.setPadPalette({
    note: selectedNote.value,
    color: paletteColor.value,
    mode: selectedMode.value
  })
  statusText.value = result.ok
    ? `已发送 ${selectedMode.value} 灯光到 Note ${selectedNote.value}`
    : `发送失败：${result.error}`
}

function formatBytes(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

async function sendManualMessage(): Promise<void> {
  const bytes = manualMessage.value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((value) =>
      Number(value.toLowerCase().startsWith('0x') ? value : Number.parseInt(value, 10))
    )
  if (
    !bytes.length ||
    bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    statusText.value = '手动消息格式错误：请输入 0–255 的十进制或 0x 十六进制字节'
    return
  }
  const result = await window.midi.send(bytes)
  statusText.value = result.ok ? `已发送：${formatBytes(bytes)}` : `发送失败：${result.error}`
}

function handleMessage(message: MidiMessageEvent): void {
  messages.value = [message, ...messages.value].slice(0, maxMessages)
  if (message.note === undefined) return
  const next = new Set(activeNotes.value)
  if (message.type === 'Note On') next.add(message.note)
  if (message.type === 'Note Off') next.delete(message.note)
  activeNotes.value = next
}

onMounted(async () => {
  removeMessageListener = window.midi.onMessage(handleMessage)
  removeConnectionListener = window.midi.onConnection((state) => {
    connection.value = state
  })
  await refreshPorts()
})

onBeforeUnmount(() => {
  removeMessageListener?.()
  removeConnectionListener?.()
})
</script>

<template>
  <div class="view-stack">
    <section class="page-heading compact-heading">
      <div>
        <p class="eyebrow">Hardware lab / MIDI</p>
        <h1>Launchpad X 测试台</h1>
        <p>确认端口、按键 Note 编号与灯光映射。接下来这些能力会被游戏页和制谱器复用。</p>
      </div>
      <div class="connection-pill" :class="{ connected: connection.connected }">
        <span></span>{{ connection.connected ? 'MIDI 已连接' : 'MIDI 未连接' }}
      </div>
    </section>

    <section class="panel connection-panel">
      <label class="field"
        ><span>MIDI 输入</span
        ><select v-model="selectedInput" class="control">
          <option :value="null">请选择输入端口</option>
          <option v-for="port in ports.inputs" :key="`in-${port.index}`" :value="port.index">
            {{ portLabel(port) }}
          </option>
        </select></label
      >
      <label class="field"
        ><span>MIDI 输出</span
        ><select v-model="selectedOutput" class="control">
          <option :value="null">请选择输出端口</option>
          <option v-for="port in ports.outputs" :key="`out-${port.index}`" :value="port.index">
            {{ portLabel(port) }}
          </option>
        </select></label
      >
      <div class="button-row">
        <button class="button button-primary" :disabled="connection.connected" @click="connect">
          连接</button
        ><button class="button" :disabled="!connection.connected" @click="disconnect">断开</button
        ><button class="button" :disabled="isRefreshing" @click="refreshPorts">
          {{ isRefreshing ? '刷新中…' : '刷新端口' }}
        </button>
      </div>
      <p class="status-line">{{ statusText }}</p>
    </section>

    <div class="debug-grid">
      <section class="panel pad-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">8 × 8 pad map</p>
            <h2>按键映射测试</h2>
            <p>按下实体 Pad 时对应格子会点亮，点击网页 Pad 可发送 RGB。</p>
          </div>
          <div class="button-row">
            <button
              class="button button-small"
              :disabled="!connection.connected"
              @click="initializeLaunchpad"
            >
              初始化</button
            ><button
              class="button button-small button-danger"
              :disabled="!connection.connected"
              @click="clearLaunchpad"
            >
              清灯
            </button>
          </div>
        </div>
        <LaunchpadGrid
          :active-notes="activeNotes"
          :selected-note="selectedNote"
          :selected-color="selectedColor"
          :disabled="!connection.connected"
          @select="sendPad"
          @hover="hoveredNote = $event"
        />
        <div class="pad-controls">
          <label class="field"
            ><span>RGB 颜色</span>
            <div class="color-row">
              <input v-model="selectedColor" type="color" /><input
                v-model="selectedColor"
                class="control mono"
                maxlength="7"
              /></div
          ></label>
          <div class="selected-note">
            <span>当前选择</span><strong>Note {{ selectedNote }}</strong>
          </div>
        </div>
        <button
          class="button button-primary full-button"
          :disabled="!connection.connected"
          @click="sendPad(selectedNote)"
        >
          发送当前 RGB
        </button>
        <p class="hover-note">Hover: {{ hoveredNote ?? '—' }} · Selected: {{ selectedNote }}</p>
      </section>

      <section class="side-stack">
        <div class="panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Raw MIDI</p>
              <h2>手动发送</h2>
            </div>
            <span class="hint-badge">十进制 / 0x 十六进制</span>
          </div>
          <div class="send-row">
            <input
              v-model="manualMessage"
              class="control mono"
              @keyup.enter="sendManualMessage"
            /><button
              class="button button-primary"
              :disabled="!connection.connected"
              @click="sendManualMessage"
            >
              发送
            </button>
          </div>
          <div class="palette-row">
            <label class="field"
              ><span>灯光模式</span
              ><select v-model="selectedMode" class="control">
                <option value="steady">Steady · 常亮</option>
                <option value="flash">Flash · 闪烁</option>
                <option value="pulse">Pulse · 呼吸</option>
              </select></label
            ><label class="field"
              ><span>Palette 色号</span
              ><input
                v-model.number="paletteColor"
                type="number"
                min="0"
                max="127"
                class="control mono"
            /></label>
          </div>
          <button
            class="button full-button"
            :disabled="!connection.connected"
            @click="sendSelectedPalette"
          >
            发送 Palette 灯光
          </button>
        </div>
        <div class="panel monitor-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Input monitor</p>
              <h2>收到的 MIDI 信号</h2>
            </div>
            <button class="button button-small" @click="messages = []">清空日志</button>
          </div>
          <div v-if="messages[0]" class="latest-message">
            <div>
              <span class="message-type">{{ messages[0].type }}</span
              ><span class="mono message-hex">{{ messages[0].hex }}</span>
            </div>
            <p>{{ messages[0].description }}</p>
          </div>
          <div v-else class="empty-state">连接并按下 Launchpad 按键，这里会显示解析结果。</div>
          <div class="message-list">
            <div
              v-for="(message, index) in messages"
              :key="`${message.receivedAt}-${index}`"
              class="message-item"
            >
              <div>
                <strong>{{ message.description }}</strong
                ><span class="mono">{{ message.hex }}</span>
              </div>
              <small
                >delta {{ message.deltaTime.toFixed(5) }}s ·
                {{ new Date(message.receivedAt).toLocaleTimeString() }}</small
              >
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
