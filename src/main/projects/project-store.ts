import { app, BrowserWindow, dialog } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, extname, join, parse } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AudioDataResult,
  CreateTrackResult,
  GameRound,
  ImageDataResult,
  ProjectResult,
  TempoPoint,
  TrackDifficulty,
  TrackListResult,
  TrackProject,
  TrackSummary
} from '../../shared/project'

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

function runFfmpeg(args: string[]): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const process = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args])
  let stderr = ''
  process.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  process.once('error', reject)
  process.once('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(stderr.trim() || `ffmpeg 退出码 ${code ?? 'unknown'}`))
  })
  return promise
}

function shiftRounds(rounds: GameRound[], offsetSec: number): GameRound[] {
  const shift = (value: number): number => Math.max(0, Number((value - offsetSec).toFixed(6)))
  return rounds.map((round) => ({
    ...round,
    prompt: { startSec: shift(round.prompt.startSec), endSec: shift(round.prompt.endSec) },
    play: { startSec: shift(round.play.startSec), endSec: shift(round.play.endSec) },
    revealAtSec: round.revealAtSec === undefined ? undefined : shift(round.revealAtSec),
    steps: round.steps.map((step) => ({
      ...step,
      startSec: shift(step.startSec),
      endSec: shift(step.endSec)
    }))
  }))
}

function shiftTempoMap(tempoMap: TempoPoint[], offsetSec: number): TempoPoint[] {
  const bpmAtOffset =
    [...tempoMap]
      .sort((a, b) => a.atSec - b.atSec)
      .filter((point) => point.atSec <= offsetSec + 0.000001)
      .at(-1)?.bpm ??
    tempoMap[0]?.bpm ??
    120
  return [
    { atSec: 0, bpm: bpmAtOffset },
    ...tempoMap
      .filter((point) => point.atSec > offsetSec + 0.000001)
      .map((point) => ({ atSec: Number((point.atSec - offsetSec).toFixed(6)), bpm: point.bpm }))
  ]
}

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
      const sourceAudioFile = `source${extension}`
      const now = new Date().toISOString()
      const project: TrackProject = {
        schemaVersion: 1,
        id,
        title: parse(sourceFileName).name,
        difficulty: 'ez',
        audioFile: sourceAudioFile,
        sourceAudioFile,
        sourceFileName,
        audioStartSec: 0,
        audioEndSec: null,
        durationSec: 0,
        createdAt: now,
        updatedAt: now,
        tempoMap: [{ atSec: 0, bpm: 120 }],
        rounds: [],
        editor: { gridOffsetMs: 0 }
      }
      await mkdir(directory, { recursive: true })
      await copyFile(sourcePath, join(directory, sourceAudioFile))
      const hasEmbeddedCover = await this.extractEmbeddedCover(sourcePath, directory)
      if (hasEmbeddedCover) {
        project.coverFile = 'cover.png'
      } else {
        const coverPath = await this.findAdjacentCover(sourcePath)
        if (coverPath) {
          await this.normalizeCover(coverPath, directory)
          project.coverFile = 'cover.png'
        }
      }

      await this.writeProject(project)
      return { cancelled: false, project }
    } catch (error) {
      return { cancelled: false, error: this.errorMessage(error) }
    }
  }

  async chooseCover(id: string, parentWindow?: BrowserWindow): Promise<ProjectResult> {
    try {
      const project = await this.readProject(id)
      const options: OpenDialogOptions = {
        title: '选择歌曲封面',
        buttonLabel: '导入封面',
        properties: ['openFile'],
        filters: [{ name: '图片文件', extensions: IMAGE_EXTENSIONS }]
      }
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) return { project }
      await this.normalizeCover(result.filePaths[0], this.projectDirectory(id))
      const next: TrackProject = {
        ...project,
        coverFile: 'cover.png',
        updatedAt: new Date().toISOString()
      }
      await this.writeProject(next)
      return { project: next }
    } catch (error) {
      return { error: this.errorMessage(error) }
    }
  }

  async readCover(id: string): Promise<ImageDataResult> {
    try {
      const project = await this.readProject(id)
      if (!project.coverFile || basename(project.coverFile) !== project.coverFile) return {}
      const extension = extname(project.coverFile).toLowerCase()
      const mimeType = MIME_TYPES[extension]
      if (!mimeType) throw new Error('无效的项目封面格式')
      return { data: await readFile(join(this.projectDirectory(id), project.coverFile)), mimeType }
    } catch (error) {
      return { error: this.errorMessage(error) }
    }
  }

  private async extractEmbeddedCover(audioPath: string, directory: string): Promise<boolean> {
    if (extname(audioPath).toLowerCase() !== '.mp3') return false
    const outputPath = join(directory, 'cover.png')
    const tempPath = `${outputPath}.embedded.tmp.png`
    try {
      await runFfmpeg([
        '-y',
        '-i',
        audioPath,
        '-map',
        '0:v:0',
        '-an',
        '-vf',
        'scale=512:512:force_original_aspect_ratio=increase,crop=512:512',
        '-frames:v',
        '1',
        tempPath
      ])
      await rename(tempPath, outputPath)
      return true
    } catch {
      await rm(tempPath, { force: true })
      return false
    }
  }
  private async normalizeCover(sourcePath: string, directory: string): Promise<void> {
    const outputPath = join(directory, 'cover.png')
    const tempPath = `${outputPath}.tmp.png`
    await runFfmpeg([
      '-y',
      '-i',
      sourcePath,
      '-vf',
      'scale=512:512:force_original_aspect_ratio=increase,crop=512:512',
      '-frames:v',
      '1',
      tempPath
    ])
    await rename(tempPath, outputPath)
  }

  private async findAdjacentCover(audioPath: string): Promise<string | null> {
    const directory = parse(audioPath).dir
    const baseName = parse(audioPath).name.toLowerCase()
    const entries = await readdir(directory, { withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(directory, entry.name))
      .filter((path) => IMAGE_EXTENSIONS.includes(extname(path).slice(1).toLowerCase()))
      .sort((a, b) => {
        const rank = (path: string): number => {
          const name = parse(path).name.toLowerCase()
          return name === baseName ? 0 : name === 'cover' || name === 'folder' ? 1 : 2
        }
        return rank(a) - rank(b)
      })
    return candidates[0] ?? null
  }

  async load(id: string): Promise<ProjectResult> {
    try {
      return { project: await this.readProject(id) }
    } catch (error) {
      return { error: this.errorMessage(error) }
    }
  }
  async readAudio(id: string): Promise<AudioDataResult> {
    return this.readAudioFile(id, false)
  }

  async readSourceAudio(id: string): Promise<AudioDataResult> {
    return this.readAudioFile(id, true)
  }

  private async readAudioFile(id: string, source: boolean): Promise<AudioDataResult> {
    try {
      const project = await this.readProject(id)
      const file = source ? (project.sourceAudioFile ?? project.audioFile) : project.audioFile
      if (basename(file) !== file) throw new Error('无效的项目音频文件名')
      return { data: await readFile(join(this.projectDirectory(id), file)) }
    } catch (error) {
      return { error: this.errorMessage(error) }
    }
  }

  private async findSourceAudioFile(
    project: TrackProject,
    directory: string
  ): Promise<string | null> {
    const preferred = project.sourceAudioFile
    if (preferred && preferred !== 'audio.mp3') {
      try {
        await readFile(join(directory, preferred))
        return preferred
      } catch {
        // Fall through to discovery for projects created before sourceAudioFile existed.
      }
    }
    const entries = await readdir(directory, { withFileTypes: true })
    const candidates = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          AUDIO_EXTENSIONS.includes(extname(entry.name).slice(1).toLowerCase()) &&
          entry.name.toLowerCase() !== 'audio.mp3'
      )
      .map((entry) => entry.name)
    return candidates[0] ?? null
  }

  async save(project: TrackProject): Promise<ProjectResult> {
    try {
      const existing = await this.readProject(project.id)
      const directory = this.projectDirectory(project.id)
      let sourceAudioFile = await this.findSourceAudioFile(existing, directory)
      if (!sourceAudioFile) throw new Error('找不到原始音频；请将原始音频放入 Track 文件夹')
      const startSec = Math.max(0, project.audioStartSec ?? 0)
      const endSec = project.audioEndSec ?? project.durationSec
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
        throw new Error('音频裁剪区间无效')
      }
      if (sourceAudioFile === existing.audioFile) {
        const backupFile = `source-${existing.audioFile}`
        await copyFile(join(directory, existing.audioFile), join(directory, backupFile))
        sourceAudioFile = backupFile
      }
      const outputPath = join(directory, 'audio.mp3')
      const rangeChanged =
        existing.audioStartSec !== startSec ||
        existing.audioEndSec !== (project.audioEndSec ?? null) ||
        existing.audioFile !== 'audio.mp3' ||
        !existing.runtimeRounds
      if (rangeChanged) {
        const tempPath = join(directory, 'audio.mp3.tmp.mp3')
        await runFfmpeg([
          '-y',
          '-i',
          join(directory, sourceAudioFile),
          '-ss',
          String(startSec),
          '-t',
          String(endSec - startSec),
          '-vn',
          '-codec:a',
          'libmp3lame',
          '-q:a',
          '2',
          tempPath
        ])
        await runFfmpeg(['-i', tempPath, '-f', 'null', '-'])
        await rename(tempPath, outputPath)
      }

      const next: TrackProject = {
        ...project,
        schemaVersion: 1,
        id: existing.id,
        audioFile: 'audio.mp3',
        sourceAudioFile,
        sourceFileName: existing.sourceFileName,
        createdAt: existing.createdAt,
        runtimeDurationSec: Number((endSec - startSec).toFixed(6)),
        runtimeTempoMap: shiftTempoMap(project.tempoMap, startSec),
        runtimeRounds: shiftRounds(project.rounds, startSec),
        updatedAt: new Date().toISOString()
      }
      await this.writeProject(next)
      return { project: next }
    } catch (error) {
      return { error: this.errorMessage(error) }
    }
  }
  async delete(id: string): Promise<{ error?: string }> {
    try {
      this.assertId(id)
      await rm(this.projectDirectory(id), { recursive: true, force: false })
      return {}
    } catch (error) {
      return { error: this.errorMessage(error) }
    }
  }

  private async readProject(id: string): Promise<TrackProject> {
    this.assertId(id)
    const json = await readFile(join(this.projectDirectory(id), 'project.json'), 'utf8')
    const project = JSON.parse(json) as Partial<TrackProject>
    return {
      ...project,
      difficulty: this.normalizeDifficulty(project.difficulty),
      audioStartSec: project.audioStartSec ?? 0,
      audioEndSec: project.audioEndSec ?? null
    } as TrackProject
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
      difficulty: this.normalizeDifficulty(project.difficulty),
      audioFile: project.audioFile,
      coverFile: project.coverFile,
      sourceFileName: project.sourceFileName,
      audioStartSec: project.audioStartSec ?? 0,
      audioEndSec: project.audioEndSec ?? null,
      durationSec: project.durationSec,
      bpm: project.tempoMap[0]?.bpm ?? 120,
      roundCount: project.rounds.length,
      updatedAt: project.updatedAt
    }
  }
  private normalizeDifficulty(value: TrackDifficulty | undefined): TrackDifficulty {
    return value === 'hd' || value === 'in' ? value : 'ez'
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
