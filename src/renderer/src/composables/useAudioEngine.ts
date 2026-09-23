import { readonly, ref, shallowRef } from 'vue'

type PlaybackEndReason = 'ended' | 'stopped'
type PlaybackEndListener = (reason: PlaybackEndReason) => void
export interface PlaybackFadeOptions {
  fadeInSec?: number
  fadeOutSec?: number
}

const audioBuffer = shallowRef<AudioBuffer | null>(null)
const loadedTrackId = ref<string | null>(null)
const loading = ref(false)
const playing = ref(false)
const error = ref<string | null>(null)
const playbackTime = ref(0)

let audioContext: AudioContext | null = null
let activeSource: AudioBufferSourceNode | null = null
let activeEndListener: PlaybackEndListener | null = null
let clipSource: AudioBufferSourceNode | null = null
let clipEndListener: PlaybackEndListener | null = null
let clipGeneration = 0
let loadGeneration = 0
let playbackStartSec = 0
let playbackEndSec = 0
let playbackStartedAt = 0
let playbackFrame: number | null = null

function getAudioContext(): AudioContext {
  audioContext ??= new AudioContext()
  return audioContext
}

async function load(trackId: string, source = false): Promise<AudioBuffer | null> {
  const generation = ++loadGeneration
  stop()
  playbackTime.value = 0
  audioBuffer.value = null
  loadedTrackId.value = null
  loading.value = true
  error.value = null

  try {
    const result = source
      ? await window.projects.readSourceAudio(trackId)
      : await window.projects.readAudio(trackId)
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

async function play(
  startSec: number,
  endSec: number,
  onEnded?: PlaybackEndListener,
  fade?: PlaybackFadeOptions
): Promise<boolean> {
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
    const gain = context.createGain()
    source.connect(gain)
    gain.connect(context.destination)
    source.onended = () => {
      if (activeSource === source) {
        stopPlaybackClock()
        activeSource = null
        playing.value = false
        playbackTime.value = end
        const listener = activeEndListener
        activeEndListener = null
        listener?.('ended')
      }
    }
    activeSource = source
    activeEndListener = onEnded ?? null
    playbackStartSec = start
    playbackEndSec = end
    playbackStartedAt = context.currentTime
    playbackTime.value = start
    playing.value = true

    const playbackDuration = end - start
    const fadeInSec = Math.min(Math.max(0, fade?.fadeInSec ?? 0), playbackDuration / 2)
    const fadeOutSec = Math.min(Math.max(0, fade?.fadeOutSec ?? 0), playbackDuration / 2)
    const now = context.currentTime
    if (fadeInSec > 0) {
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(1, now + fadeInSec)
    } else {
      gain.gain.setValueAtTime(1, now)
    }
    if (fadeOutSec > 0) {
      gain.gain.setValueAtTime(1, now + playbackDuration - fadeOutSec)
      gain.gain.linearRampToValueAtTime(0, now + playbackDuration)
    }

    source.start(0, start, end - start)
    startPlaybackClock()
    return true
  } catch (cause) {
    activeSource = null
    activeEndListener = null
    playing.value = false
    error.value = messageFrom(cause)
    return false
  }
}

async function playClip(
  startSec: number,
  endSec: number,
  onEnded?: PlaybackEndListener
): Promise<boolean> {
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

  stopClip()
  const generation = ++clipGeneration
  error.value = null

  try {
    const context = getAudioContext()
    if (context.state === 'suspended') await context.resume()
    if (generation !== clipGeneration) return false

    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.onended = () => {
      if (clipSource === source) {
        clipSource = null
        const listener = clipEndListener
        clipEndListener = null
        listener?.('ended')
      }
    }
    clipSource = source
    clipEndListener = onEnded ?? null
    source.start(0, start, end - start)
    return true
  } catch (cause) {
    if (generation === clipGeneration) {
      clipSource = null
      clipEndListener = null
      error.value = messageFrom(cause)
    }
    return false
  }
}

function stopClip(): void {
  ++clipGeneration
  const source = clipSource
  const listener = clipEndListener
  clipSource = null
  clipEndListener = null
  if (!source) {
    listener?.('stopped')
    return
  }

  source.onended = null
  source.stop()
  source.disconnect()
  listener?.('stopped')
}

function stop(): void {
  stopClip()
  stopPlaybackClock()
  const source = activeSource
  const nextPlaybackTime = currentPlaybackTime()
  const listener = activeEndListener
  activeSource = null
  activeEndListener = null
  playing.value = false
  playbackTime.value = nextPlaybackTime
  if (!source) {
    listener?.('stopped')
    return
  }

  source.onended = null
  source.stop()
  source.disconnect()
  listener?.('stopped')
}

function seek(timeSec: number): void {
  if (!audioBuffer.value || !Number.isFinite(timeSec)) return
  if (activeSource || clipSource) stop()
  playbackTime.value = Math.min(audioBuffer.value.duration, Math.max(0, timeSec))
}

function dispose(): void {
  ++loadGeneration
  stop()
  playbackTime.value = 0

  const context = audioContext
  audioContext = null
  activeSource = null
  audioBuffer.value = null
  loadedTrackId.value = null
  loading.value = false
  error.value = null

  if (context) {
    void context.close().catch(() => {
      // AudioContext can already be closed when leaving the page.
    })
  }
}

function clear(): void {
  ++loadGeneration
  stop()
  playbackTime.value = 0
  audioBuffer.value = null
  loadedTrackId.value = null
  loading.value = false
  error.value = null
}

function clearError(): void {
  error.value = null
}

function startPlaybackClock(): void {
  stopPlaybackClock()
  playbackFrame = requestAnimationFrame(updatePlaybackTime)
}

function stopPlaybackClock(): void {
  if (playbackFrame === null) return
  cancelAnimationFrame(playbackFrame)
  playbackFrame = null
}

function updatePlaybackTime(): void {
  if (!activeSource) return
  playbackTime.value = currentPlaybackTime()
  playbackFrame = requestAnimationFrame(updatePlaybackTime)
}

function currentPlaybackTime(): number {
  if (!activeSource) return playbackTime.value
  return Math.min(
    playbackEndSec,
    Math.max(
      playbackStartSec,
      playbackStartSec + (getAudioContext().currentTime - playbackStartedAt)
    )
  )
}

function messageFrom(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const audioEngine = {
  audioBuffer: readonly(audioBuffer),
  loadedTrackId: readonly(loadedTrackId),
  loading: readonly(loading),
  playing: readonly(playing),
  playbackTime: readonly(playbackTime),
  error: readonly(error),
  load,
  play,
  playClip,
  stop,
  seek,
  clear,
  dispose,
  clearError
}

export function useAudioEngine(): typeof audioEngine {
  return audioEngine
}
