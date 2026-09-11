export interface TrackProject {
  schemaVersion: 1
  id: string
  title: string
  artist?: string
  audioFile: string
  sourceFileName: string
  durationSec: number
  createdAt: string
  updatedAt: string
  tempoMap: TempoPoint[]
  rounds: GameRound[]
}

export interface TrackSummary {
  id: string
  title: string
  artist?: string
  audioFile: string
  sourceFileName: string
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
  steps: ClipStep[]
}

export interface TimeRange {
  startSec: number
  endSec: number
}

export interface ClipStep extends TimeRange {
  id: string
  padNote: number
  color: { red: number; green: number; blue: number }
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

export interface ProjectApi {
  list: () => Promise<TrackListResult>
  create: () => Promise<CreateTrackResult>
  load: (id: string) => Promise<ProjectResult>
  save: (project: TrackProject) => Promise<ProjectResult>
  readAudio: (id: string) => Promise<AudioDataResult>
  getStorageRoot: () => Promise<string>
}
