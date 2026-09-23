import { readonly, ref } from 'vue'
import type { GameRound, TrackProject, TrackSummary } from '../../../shared/project'

const tracks = ref<TrackSummary[]>([])
const currentProject = ref<TrackProject | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const storageRoot = ref('')
let refreshGeneration = 0

async function refreshProjects(): Promise<void> {
  const generation = ++refreshGeneration
  loading.value = true
  error.value = null

  try {
    const result = await window.projects.list()
    if (generation !== refreshGeneration) return
    tracks.value = result.tracks
    error.value = result.error ?? null
  } catch (cause) {
    if (generation === refreshGeneration) error.value = messageFrom(cause)
  } finally {
    if (generation === refreshGeneration) loading.value = false
  }
}

async function createTrack(): Promise<TrackProject | null> {
  loading.value = true
  error.value = null

  try {
    const result = await window.projects.create()
    if (result.error) {
      error.value = result.error
      return null
    }
    if (result.cancelled || !result.project) return null

    const normalized = normalizeProject(result.project)
    currentProject.value = normalized
    await refreshProjects()
    return normalized
  } catch (cause) {
    error.value = messageFrom(cause)
    return null
  } finally {
    loading.value = false
  }
}

async function loadProject(id: string): Promise<TrackProject | null> {
  loading.value = true
  error.value = null

  try {
    const result = await window.projects.load(id)
    if (result.error || !result.project) {
      error.value = result.error ?? 'Track 项目不存在'
      return null
    }

    const project = normalizeProject(result.project)
    currentProject.value = project
    return project
  } catch (cause) {
    error.value = messageFrom(cause)
    return null
  } finally {
    loading.value = false
  }
}

async function saveProject(project: TrackProject): Promise<TrackProject | null> {
  loading.value = true
  error.value = null

  try {
    // Electron IPC uses structured clone and cannot transfer Vue reactive proxies.
    // Track data is JSON-only, so normalize it before crossing the process boundary.
    const plainProject = JSON.parse(JSON.stringify(project)) as TrackProject
    const result = await window.projects.save(plainProject)
    if (result.error || !result.project) {
      error.value = result.error ?? 'Track 保存失败'
      return null
    }

    const normalized = normalizeProject(result.project)
    currentProject.value = normalized
    await refreshProjects()
    return normalized
  } catch (cause) {
    error.value = messageFrom(cause)
    return null
  } finally {
    loading.value = false
  }
}
async function deleteProject(id: string): Promise<{ error?: string }> {
  loading.value = true
  error.value = null
  try {
    const result = await window.projects.delete(id)
    if (result.error) error.value = result.error
    return result
  } catch (cause) {
    error.value = messageFrom(cause)
    return { error: error.value }
  } finally {
    loading.value = false
  }
}

async function loadStorageRoot(): Promise<void> {
  if (storageRoot.value) return

  try {
    storageRoot.value = await window.projects.getStorageRoot()
  } catch (cause) {
    error.value = messageFrom(cause)
  }
}

function clearError(): void {
  error.value = null
}

function normalizeProject(value: TrackProject): TrackProject {
  return {
    ...value,
    difficulty: value.difficulty === 'hd' || value.difficulty === 'in' ? value.difficulty : 'ez',
    audioStartSec: value.audioStartSec ?? 0,
    audioEndSec: value.audioEndSec ?? null,
    rounds: value.rounds.map((round) => ({
      ...round,
      prompt: { ...round.prompt },
      play: { ...round.play },
      steps: normalizeSteps(round.steps)
    }))
  }
}

function normalizeSteps(steps: GameRound['steps']): GameRound['steps'] {
  return steps.map((step) => ({
    ...step,
    padNotes:
      step.padNotes && step.padNotes.length > 0
        ? [...step.padNotes]
        : step.padNote === undefined
          ? []
          : [step.padNote]
  }))
}

function messageFrom(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const projectState = {
  tracks: readonly(tracks),
  currentProject: readonly(currentProject),
  loading: readonly(loading),
  error: readonly(error),
  storageRoot: readonly(storageRoot),
  refreshProjects,
  createTrack,
  loadProject,
  saveProject,
  deleteProject,
  loadStorageRoot,
  clearError
}

export function useProjects(): typeof projectState {
  return projectState
}
