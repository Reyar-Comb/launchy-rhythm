export type TrackDifficulty = 'ez' | 'hd' | 'in'

export interface TrackProject {
  schemaVersion: 1
  id: string
  title: string
  artist?: string
  difficulty: TrackDifficulty
  /** 当前编辑器使用的原始音频文件。 */
  audioFile: string
  /** 裁剪前的原始音频文件；旧项目缺失时回退到 audioFile。 */
  sourceAudioFile?: string
  coverFile?: string
  sourceFileName: string
  /** 编辑器时间轴中的原始音频起点。 */
  audioStartSec: number
  /** 编辑器时间轴中的原始音频终点；null 表示原始音频末尾。 */
  audioEndSec: number | null
  /** 原始音频时长，供编辑器使用。 */
  durationSec: number
  /** 导出 audio.mp3 的时长。 */
  runtimeDurationSec?: number
  createdAt: string
  updatedAt: string
  tempoMap: TempoPoint[]
  rounds: GameRound[]
  /** 根据原始时间轴导出的运行时谱面。 */
  runtimeTempoMap?: TempoPoint[]
  runtimeRounds?: GameRound[]
  editor?: TrackEditorSettings
}

export interface TrackEditorSettings {
  gridOffsetMs: number
}

export interface TrackSummary {
  id: string
  title: string
  artist?: string
  difficulty: TrackDifficulty
  audioFile: string
  coverFile?: string
  sourceFileName: string
  audioStartSec: number
  audioEndSec: number | null
  durationSec: number
  bpm: number
  roundCount: number
  updatedAt: string
}

export interface TempoPoint {
  atSec: number
  bpm: number
}

export interface GameRound {
  id: string
  prompt: TimeRange
  play: TimeRange
  /**
   * Prompt 段内的显式事件点：所有 Play taps 切换为 Play 常亮色，并开放提前输入。
   * 不设置时，Play taps 在 Play 段开始时才全亮，但仍保留最后一拍的一小段提前输入窗口。
   */
  revealAtSec?: number
  steps: ClipStep[]
}

export interface TimeRange {
  startSec: number
  endSec: number
}

export interface ClipStep extends TimeRange {
  id: string
  padNotes?: number[]
  padNote?: number
  color: { red: number; green: number; blue: number }
  hitEffect?: StepHitEffect
}

export type StepHitEffect = 'cross' | 'corner' | 'burst' | 'rice'

export const STEP_HIT_EFFECTS: readonly StepHitEffect[] = ['cross', 'corner', 'burst', 'rice']

const outerRingPadNotes = new Set<number>()
for (let row = 1; row <= 8; row += 1) {
  for (let column = 1; column <= 8; column += 1) {
    if (row === 1 || row === 8 || column === 1 || column === 8) {
      outerRingPadNotes.add(row * 10 + column)
    }
  }
}

export const OUTER_RING_PAD_NOTES: ReadonlySet<number> = outerRingPadNotes

export function isPlayablePadNote(note: number): boolean {
  const row = Math.floor(note / 10)
  const column = note % 10
  return (
    Number.isInteger(note) &&
    row >= 1 &&
    row <= 8 &&
    column >= 1 &&
    column <= 8 &&
    !OUTER_RING_PAD_NOTES.has(note)
  )
}

export function getStepPadNotes(step: ClipStep): number[] {
  if (step.padNotes?.length) return step.padNotes
  return step.padNote === undefined ? [] : [step.padNote]
}

export interface TrackListResult {
  tracks: TrackSummary[]
  error?: string
}

export interface CreateTrackResult {
  cancelled: boolean
  project?: TrackProject
  error?: string
}

export interface ProjectResult {
  project?: TrackProject
  error?: string
}

export interface AudioDataResult {
  data?: Uint8Array
  error?: string
}
export interface ImageDataResult {
  data?: Uint8Array
  mimeType?: string
  error?: string
}

export interface ProjectApi {
  list: () => Promise<TrackListResult>
  create: () => Promise<CreateTrackResult>
  load: (id: string) => Promise<ProjectResult>
  save: (project: TrackProject) => Promise<ProjectResult>
  delete: (id: string) => Promise<{ error?: string }>
  chooseCover: (id: string) => Promise<ProjectResult>
  readAudio: (id: string) => Promise<AudioDataResult>
  readSourceAudio: (id: string) => Promise<AudioDataResult>
  readCover: (id: string) => Promise<ImageDataResult>
  getStorageRoot: () => Promise<string>
}
