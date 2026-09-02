export interface TrackProject {
  schemaVersion: 1
  id: string
  title: string
  artist?: string
  audioFile: string
  durationSec: number
  tempoMap: TempoPoint[]
  rounds: GameRound[]
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
