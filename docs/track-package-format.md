# Launchy Rhythm 谱面交接文档

## 1. 交付目录

最终交给现场客户端的每首歌是一个独立目录，只需要这三个文件：

```text
tracks/<track-id>/
├── audio.mp3
├── cover.png
└── project.json
```

文件约定：

- `audio.mp3`：已经按工程音频起止点导出的运行时音频。运行时从 0 秒开始，不再使用原始音频的绝对时间。
- `cover.png`：歌曲封面，标准尺寸为 `512 × 512`。
- `project.json`：歌曲信息、编辑器原始时间轴、运行时导出谱面和灯光配置。

现场交付不需要携带原始音频，例如 `source.wav`、`source.mp3` 或 `hywaudio.mp3`。这些文件只用于本地制谱和重新导出。

> 如果要在另一台机器继续编辑，仍然需要携带原始音频，并将 `sourceAudioFile` 指向该文件；只携带三个交付文件适合试玩 / 正式运行，不适合完整重新制谱。

## 2. project.json 的核心字段

```ts
interface TrackProject {
  schemaVersion: 1
  id: string
  title: string
  artist?: string
  difficulty: 'ez' | 'hd' | 'in'

  // 编辑器 / 原始音频
  audioFile: string
  sourceAudioFile?: string
  sourceFileName: string
  audioStartSec: number
  audioEndSec: number | null
  durationSec: number
  tempoMap: TempoPoint[]
  rounds: GameRound[]

  // 导出 / 运行时
  runtimeDurationSec?: number
  runtimeTempoMap?: TempoPoint[]
  runtimeRounds?: GameRound[]

  coverFile?: string
  editor?: {
    gridOffsetMs: number
  }
  createdAt: string
  updatedAt: string
}
```

现场运行时至少应保证这些字段存在：

```json
{
  "audioFile": "audio.mp3",
  "coverFile": "cover.png",
  "runtimeDurationSec": 39,
  "runtimeTempoMap": [{ "atSec": 0, "bpm": 127 }],
  "runtimeRounds": []
}
```

当前客户端在正式游戏中优先使用：

```text
runtimeRounds
runtimeTempoMap
runtimeDurationSec
```

如果没有运行时字段，客户端会回退到旧的 `rounds`、`tempoMap` 和原始音频时间规则，但正式交付不应依赖这个回退行为。

## 3. 编辑器时间轴与运行时时间轴

现在保存两套谱面数据。

### 3.1 编辑器原始时间轴

以下字段全部使用原始音频的绝对秒数：

```text
audioStartSec
audioEndSec
tempoMap
rounds
```

例如原始音频中：

```text
Round Prompt：55.000 ～ 60.000
Round Play：61.000 ～ 66.000
Note：62.500
```

制谱器继续使用这些时间戳，因此可以按照原曲完整波形定位、修改和吸附。

### 3.2 运行时导出时间轴

保存工程时，程序把原始音频裁剪为：

```text
[audioStartSec, audioEndSec]
```

随后所有谱面时间减去 `audioStartSec`：

```text
runtimeTime = originalTime - audioStartSec
```

上面的例子如果起点是 `55.000` 秒，运行时会变成：

```text
Round Prompt：0.000 ～ 5.000
Round Play：6.000 ～ 11.000
Note：7.500
```

运行时音频也从 0 秒开始，所以两套时间轴重新对齐。

## 4. 音频导出流程

点击保存工程时，Main Process 执行以下流程：

```text
读取 sourceAudioFile
→ 使用 FFmpeg 裁剪 audioStartSec ～ audioEndSec
→ 输出临时 MP3
→ 用 FFmpeg 重新读取验证
→ 原子替换 audio.mp3
→ 生成 runtimeRounds / runtimeTempoMap
→ 写入 project.json
```

输出使用本机 `ffmpeg` 和 `libmp3lame`。

如果 FFmpeg 失败，临时文件不会替换正式的 `audio.mp3`，避免产生几字节的损坏音频。

### 原始音频字段

本地制谱项目可以这样保存：

```json
{
  "audioFile": "audio.mp3",
  "sourceAudioFile": "hywaudio.mp3"
}
```

含义：

- `sourceAudioFile` 是裁剪前原始音频，只给编辑器和下一次导出使用。
- `audioFile` 是当前导出的运行时音频，给正式游戏使用。

旧项目如果没有 `sourceAudioFile`，保存时会在 Track 文件夹内自动寻找非 `audio.mp3` 的音频文件作为原始音频。

## 5. Round 与 Note 机制

### Round

```ts
interface GameRound {
  id: string
  prompt: {
    startSec: number
    endSec: number
  }
  play: {
    startSec: number
    endSec: number
  }
  revealAtSec?: number
  steps: ClipStep[]
}
```

- `prompt`：系统播放示例段，同时按 Note 顺序提示灯光。
- `play`：玩家输入段，backing track 静音，等待按键。
- `revealAtSec`：可选。到达该时间后，所有未完成目标亮起并允许提前输入。
- 当前规则仍要求 Prompt 和 Play 绝对长度相等。
- 当前规则要求 Play 接在 Prompt 后面。
- BPM 变速点只改变网格 / 节拍计算，不改变音频播放速度。

### Note

```ts
interface ClipStep {
  id: string
  startSec: number
  endSec: number
  padNotes?: number[]
  color: {
    red: number
    green: number
    blue: number
  }
  hitEffect?: 'cross' | 'corner' | 'burst' | 'rice'
}
```

- `startSec` / `endSec` 在编辑器 `rounds` 中是原始绝对秒数。
- `runtimeRounds` 中会变成裁剪后的相对秒数。
- `padNotes` 支持单押、双押和多押。
- Pad 只能使用 Launchpad X 中间 6×6 内圈。
- 同一个 Note 的所有 `padNotes` 必须全部按下才算完成。
- 不同 Note 之间不能有时间重叠。
- `hitEffect` 缺省时运行时按 `cross` 处理。

## 6. 正式游戏状态机

运行时主要阶段：

```text
idle
→ loading
→ playing-track
→ prompting
→ waiting-for-input
→ playing-clip
→ resuming-track
→ prompting / success
```

流程：

1. 加载 `audio.mp3`。
2. 读取 `runtimeRounds`。
3. 从运行时 0 秒开始播放。
4. 播放到下一个 Round 的 Prompt。
5. Prompt 阶段播放示例段并显示目标 Pad。
6. 进入 Play 阶段后 backing track 静音。
7. 玩家按正确 Pad，播放对应 Note 的音频切片。
8. 一个 Round 完成后，从 `round.play.endSec` 继续播放 `audio.mp3`。
9. 到下一个 Round 的 Prompt 后重复。
10. 全部 Round 完成后播放到 `runtimeDurationSec` 并结束。

## 7. 输入规则

- Note On 的 velocity 必须达到 MIDI 输入设置中的阈值。
- 默认力度阈值为 1。
- 同一个 Pad 在防抖时间内重复触发会被忽略，默认防抖时间为 50ms。
- 正式游戏和 Real Test 使用同一套输入规则。
- 只有等待输入、播放 Clip 或已开放提前输入的 Prompt 阶段接受玩家输入。
- 普通 Prompt 灯光亮起不等于已经允许提前输入；是否允许由 Reveal / 默认提前窗口决定。
- 累计 3 次错误后本局失败。

## 8. 与原先格式 / 机制的区别

### 原先

原先只有一套时间轴：

```text
audioFile + audioStartSec + audioEndSec + rounds
```

主要问题：

- `audioFile` 可能仍是完整原始音频。
- `audioStartSec` / `audioEndSec` 只作为播放边界。
- 游戏仍然依赖原始音频的绝对秒数。
- 把工程拷到另一台机器时，需要原始音频才能保持时间轴一致。
- 保存时间区间不会生成一个独立的运行时音频包。

### 现在

现在明确拆成两套：

```text
编辑器：原始音频 + 原始绝对时间轴
运行时：裁剪后的 audio.mp3 + 从 0 秒开始的相对时间轴
```

新增内容：

- `sourceAudioFile`：记录原始音频，仅供编辑器重新导出。
- `runtimeRounds`：裁剪后、已整体位移的运行时谱面。
- `runtimeTempoMap`：裁剪后、已整体位移的 BPM Map。
- `runtimeDurationSec`：裁剪后音频时长。
- `audio.mp3`：保存时由 FFmpeg 生成的最终运行时文件。
- 封面统一转成 `cover.png`，尺寸为 `512 × 512`。

### 重要区别

正式客户端不再需要知道原始音频的起始秒数，也不需要携带原始音频。它直接：

```text
audio.mp3 从 0 秒播放
runtimeRounds 从 0 秒读取
```

## 9. 交付前检查清单

每个 Track 目录应确认：

- [ ] 只有或至少包含 `audio.mp3`、`cover.png`、`project.json`。
- [ ] `audio.mp3` 可以被 FFmpeg / 系统播放器正常打开。
- [ ] `cover.png` 是 `512 × 512`。
- [ ] `project.json.audioFile === "audio.mp3"`。
- [ ] `project.json.coverFile === "cover.png"`。
- [ ] 存在 `runtimeRounds`。
- [ ] 存在 `runtimeTempoMap`。
- [ ] 存在 `runtimeDurationSec`。
- [ ] `runtimeRounds` 的所有时间都在 `[0, runtimeDurationSec]` 内。
- [ ] `runtimeRounds` 中的第一个 Prompt 不早于 0 秒。
- [ ] `runtimeRounds` 中的 Note 时间使用运行时相对秒数。
- [ ] 交付包不依赖 `sourceAudioFile` 指向的本地文件。
