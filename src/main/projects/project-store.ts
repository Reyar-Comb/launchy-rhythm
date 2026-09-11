import { app, BrowserWindow, dialog } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, extname, join, parse } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AudioDataResult,
  CreateTrackResult,
  ProjectResult,
  TrackListResult,
  TrackProject,
  TrackSummary
} from '../../shared/project'

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']

export class ProjectStore {
  readonly rootPath: string

  constructor() {
    this.rootPath = app.isPackaged
      ? join(app.getPath('userData'), 'tracks')
      : join(app.getAppPath(), 'tracks')
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true })
  }

  async list(): Promise<TrackListResult> {
    try {
      await this.initialize()
      const entries = await readdir(this.rootPath, { withFileTypes: true })
      const projects = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            try {
              return await this.readProject(entry.name)
            } catch {
              return null
            }
          })
      )

      const tracks = projects
        .filter((project): project is TrackProject => project !== null)
        .map((project) => this.toSummary(project))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

      return { tracks }
    } catch (error) {
      return { tracks: [], error: this.errorMessage(error) }
    }
  }

  async create(parentWindow?: BrowserWindow): Promise<CreateTrackResult> {
    try {
      const options: OpenDialogOptions = {
        title: '选择 Track 音频',
        buttonLabel: '导入音频',
        message: '选择一首歌曲的 backing track。文件会复制到 Launchy Rhythm 项目目录。',
        properties: ['openFile'],
        filters: [
          { name: '音频文件', extensions: AUDIO_EXTENSIONS },
          { name: '所有文件', extensions: ['*'] }
        ]
      }
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options)

      if (result.canceled || !result.filePaths[0]) return { cancelled: true }

      await this.initialize()
      const sourcePath = result.filePaths[0]
      const sourceFileName = basename(sourcePath)
      const extension = extname(sourcePath).toLowerCase() || '.audio'
      const id = `${this.slug(parse(sourceFileName).name)}-${randomUUID().slice(0, 8)}`
      const directory = this.projectDirectory(id)
      const audioFile = `audio${extension}`
      const now = new Date().toISOString()
      const project: TrackProject = {
        schemaVersion: 1,
        id,
        title: parse(sourceFileName).name,
        audioFile,
        sourceFileName,
        durationSec: 0,
        createdAt: now,
        updatedAt: now,
        tempoMap: [{ atSec: 0, bpm: 120 }],
        rounds: []
      }

      await mkdir(directory, { recursive: true })
      await copyFile(sourcePath, join(directory, audioFile))
      await this.writeProject(project)
      return { cancelled: false, project }
    } catch (error) {
      return { cancelled: false, error: this.errorMessage(error) }
    }
  }

  async load(id: string): Promise<ProjectResult> {
    try {
      return { project: await this.readProject(id) }
    } catch (error) {
      return { error: this.errorMessage(error) }
    }
  }
  async readAudio(id: string): Promise<AudioDataResult> {
    try {
      const project = await this.readProject(id)
      if (basename(project.audioFile) !== project.audioFile) {
        throw new Error('无效的项目音频文件名')
      }

      const data = await readFile(join(this.projectDirectory(id), project.audioFile))
      return { data }
    } catch (error) {
      return { error: this.errorMessage(error) }
    }
  }

  async save(project: TrackProject): Promise<ProjectResult> {
    try {
      const existing = await this.readProject(project.id)
      const next: TrackProject = {
        ...project,
        schemaVersion: 1,
        id: existing.id,
        audioFile: existing.audioFile,
        sourceFileName: existing.sourceFileName,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString()
      }
      await this.writeProject(next)
      return { project: next }
    } catch (error) {
      return { error: this.errorMessage(error) }
    }
  }

  private async readProject(id: string): Promise<TrackProject> {
    this.assertId(id)
    const json = await readFile(join(this.projectDirectory(id), 'project.json'), 'utf8')
    return JSON.parse(json) as TrackProject
  }

  private async writeProject(project: TrackProject): Promise<void> {
    this.assertId(project.id)
    await mkdir(this.projectDirectory(project.id), { recursive: true })
    await writeFile(
      join(this.projectDirectory(project.id), 'project.json'),
      `${JSON.stringify(project, null, 2)}\n`,
      'utf8'
    )
  }

  private projectDirectory(id: string): string {
    return join(this.rootPath, id)
  }

  private toSummary(project: TrackProject): TrackSummary {
    return {
      id: project.id,
      title: project.title,
      artist: project.artist,
      audioFile: project.audioFile,
      sourceFileName: project.sourceFileName,
      durationSec: project.durationSec,
      bpm: project.tempoMap[0]?.bpm ?? 120,
      roundCount: project.rounds.length,
      updatedAt: project.updatedAt
    }
  }

  private assertId(id: string): void {
    if (!/^[\p{Letter}\p{Number}_-]+$/u.test(id)) throw new Error('无效的 Track ID')
  }

  private slug(value: string): string {
    const slug = value
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
    return slug || 'track'
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
