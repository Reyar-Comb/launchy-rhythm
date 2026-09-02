export type GamePhase =
  | 'idle'
  | 'loading'
  | 'playing-track'
  | 'prompting'
  | 'waiting-for-input'
  | 'playing-clip'
  | 'resuming-track'
  | 'failed'

export interface GameInputEvent {
  note: number
  receivedAt: number
}
