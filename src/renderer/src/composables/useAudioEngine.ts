import { readonly, ref, shallowRef } from 'vue'

const audioBuffer = shallowRef<AudioBuffer | null>(null)
const loadedTrackId = ref<string | null>(null)
const loading = ref(false)
const playing = ref(false)
const error = ref<string | null>(null)

let audioContext: AudioContext | null = null
let activeSource: AudioBufferSourceNode | null = null
let loadGeneration = 0

function getAudioContext(): AudioContext {
  audioContext ??= new AudioContext()
  return audioContext
}

async function load(trackId: string): Promise<AudioBuffer | null> {
  const generation = ++loadGeneration
  stop()
  audioBuffer.value = null
  loadedTrackId.value = null
  loading.value = true
  error.value = null

  try {
    const result = await window.projects.readAudio(trackId)
    if (generation !== loadGeneration) return null
    if (result.error || !result.data) {
      throw new Error(result.error ?? '音频文件读取失败')
    }

    const encoded = new Uint8Array(result.data).buffer
    const decoded = await getAudioContext().decodeAudioData(encoded)
    if (generation !== loadGeneration) return null

    audioBuffer.value = decoded
    loadedTrackId.value = trackId
    return decoded
  } catch (cause) {
    if (generation === loadGeneration) error.value = messageFrom(cause)
    return null
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

async function play(startSec: number, endSec: number): Promise<boolean> {
  const buffer = audioBuffer.value
  if (!buffer) {
    error.value = '音频尚未加载完成'
    return false
  }
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    error.value = '起止时间必须是有效数字'
    return false
  }

  const start = Math.max(0, startSec)
  const end = Math.min(buffer.duration, endSec)
  if (end <= start) {
    error.value = '结束时间必须晚于开始时间'
    return false
  }

  stop()
  error.value = null

  try {
    const context = getAudioContext()
    if (context.state === 'suspended') await context.resume()

    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.onended = () => {
      if (activeSource === source) {
        activeSource = null
        playing.value = false
      }
    }
    activeSource = source
    playing.value = true
    source.start(0, start, end - start)
    return true
  } catch (cause) {
    activeSource = null
    playing.value = false
    error.value = messageFrom(cause)
    return false
  }
}

function stop(): void {
  const source = activeSource
  activeSource = null
  playing.value = false
  if (!source) return

  source.onended = null
  source.stop()
  source.disconnect()
}

function clear(): void {
  ++loadGeneration
  stop()
  audioBuffer.value = null
  loadedTrackId.value = null
  loading.value = false
  error.value = null
}

function clearError(): void {
  error.value = null
}

function messageFrom(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const audioEngine = {
  audioBuffer: readonly(audioBuffer),
  loadedTrackId: readonly(loadedTrackId),
  loading: readonly(loading),
  playing: readonly(playing),
  error: readonly(error),
  load,
  play,
  stop,
  clear,
  clearError
}

export function useAudioEngine(): typeof audioEngine {
  return audioEngine
}
