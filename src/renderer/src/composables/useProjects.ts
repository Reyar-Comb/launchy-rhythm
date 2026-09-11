import { readonly, ref } from 'vue'
import type { TrackProject, TrackSummary } from '../../../shared/project'

const tracks = ref<TrackSummary[]>([])
const currentProject = ref<TrackProject | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const storageRoot = ref('')

async function refreshProjects(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const result = await window.projects.list()
    tracks.value = result.tracks
    error.value = result.error ?? null
  } catch (cause) {
    error.value = messageFrom(cause)
  } finally {
    loading.value = false
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

    currentProject.value = result.project
    await refreshProjects()
    return result.project
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

    currentProject.value = result.project
    return result.project
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
    const result = await window.projects.save(project)
    if (result.error || !result.project) {
      error.value = result.error ?? 'Track 保存失败'
      return null
    }

    currentProject.value = result.project
    await refreshProjects()
    return result.project
  } catch (cause) {
    error.value = messageFrom(cause)
    return null
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
  loadStorageRoot,
  clearError
}

export function useProjects(): typeof projectState {
  return projectState
}
