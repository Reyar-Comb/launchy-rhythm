# Launchy Rhythm 开发说明与进度快照

> 更新时间：2026-09-10  
> 目标平台：macOS + Launchpad X。当前只需开发模式可用，不要求完整安装包。

## 项目目标

Launchy Rhythm 是社团招新摆摊用的 Electron 桌面小游戏。玩家跟随 Launchpad X 的灯光提示按 Pad，按顺序完成指定片段后原曲继续播放；按错即失败。游戏风格参考《节奏天国》，但对路人不做节奏精度要求，只校验按键顺序。

核心体验：

1. 选择一首歌。
2. 系统播放示例段，同时在 Launchpad X 上高亮即将要按的 Pad。
3. 进入玩家段后 backing track 静音。
4. 玩家按对 Pad 时，播放该 Pad 绑定的音频 clip。
5. 所有步骤按顺序完成后，backing track 从后续位置继续。
6. 按错任意 Pad 立即失败。

明确的产品约束：

- 只支持 macOS，优先 Electron 开发模式。
- 预计 5～6 首歌，一首歌只对应一个 backing track。
- 默认拍号 4/4。
- Round 支持整小节、半小节、1/4 小节和自定义时间区间。
- BPM 可在已知时间点变化，后续示例段切换点可以是半小节甚至 1/4 小节。
- 不要求玩家节奏精准，只要求按键顺序正确。
- 这是小 demo，不追求复杂扩展性和防御式编程；优先实现原本功能、稳定运行和好看的浅色界面。
- UI 必须是白底浅色模式，主强调色为青绿色。不要使用深紫蓝色主题。

## 技术栈

- Desktop shell：Electron 44 + electron-vite 5
- 前端：Vue 3 `<script setup>` + TypeScript
- 样式：Tailwind CSS 4 已接入，但当前主要样式集中在 `src/renderer/src/assets/main.css`
- MIDI：`@julusian/midi`，运行在 Electron main process
- 音频：`tone` 已安装但尚未接入；阶段三将实现整首音频加载和区间播放
- 持久化：每个 Track 一个目录，`project.json` + 音频副本
- 格式化 / 检查：Prettier、ESLint、`tsc`、`vue-tsc`

常用命令：

```bash
npm run dev        # Electron 开发模式
npm run lint       # ESLint
npm run typecheck  # node + web 类型检查
npm run build      # 类型检查 + electron-vite build
```

交付前至少运行：

```bash
npm run lint
npm run build
```

涉及 MIDI 时还要实机运行 `npm run dev`，在 MIDI 测试台确认端口、收发和灯光。

## 当前总体进度

### 阶段一：正式应用骨架与 MIDI 硬件链路 — 已完成

已完成：

- Electron + Vue + TypeScript + Tailwind 工程可运行。
- 浅色模式正式应用布局：侧边栏、歌曲库、制谱器、游戏页、MIDI 测试台。
- 响应式布局，适配小屏幕。
- Launchpad X 端口枚举与自动推荐。
- MIDI 输入输出连接。
- MIDI 消息解析：Note On / Note Off、CC、Aftertouch、SysEx 等。
- MIDI 手动消息发送。
- 8×8 Launchpad 可视化网格。
- Launchpad X Programmer Mode 初始化。
- RGB 与 Palette 灯光发送。
- 清空 8×8 网格灯光。
- 用户已实机验证：接收、按键识别、灯光发送均正常，8×8 映射正确。

阶段一关键文件：

- `src/main/midi/midi-manager.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/shared/midi.ts`
- `src/renderer/src/views/MidiDebugView.vue`
- `src/renderer/src/components/launchpad/LaunchpadGrid.vue`
- `src/renderer/src/App.vue`
- `src/renderer/src/assets/main.css`

### 阶段二：Track 项目持久化与基础编辑 — 已完成

已完成：

- 每个 Track 独立目录持久化。
- macOS 原生音频选择器。
- 支持 MP3、WAV、M4A、AAC、FLAC、OGG。
- 新建 Track 时复制音频到项目目录。
- 自动生成 Track ID，支持中文文件名。
- 生成默认 `project.json`。
- 曲库真实读取。
- 曲库卡片显示标题、艺术家、BPM、Round 数、更新时间和源文件名。
- 制谱器基础信息编辑：标题、艺术家、初始 BPM。
- 保存 `project.json` 后曲库同步刷新。
- 试玩页可以接收并加载所选 Track。
- 显示本地 Track 项目目录。
- 开发模式与打包模式的存储目录区分。
- `tracks/` 已加入 `.gitignore`。

阶段二关键文件：

- `src/main/projects/project-store.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/shared/project.ts`
- `src/renderer/src/composables/useProjects.ts`
- `src/renderer/src/views/LibraryView.vue`
- `src/renderer/src/views/EditorView.vue`
- `src/renderer/src/views/GameView.vue`

已通过验证：

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- Electron 开发模式启动
- MIDI 收发与灯光已由用户实机验证

当前限制：

- 音频时长尚未读取，曲库中显示“待读取”。
- 尚未实现音频区间播放。
- 尚未实现波形展示。
- 尚未实现 Round、ClipStep 和 Pad 绑定编辑。
- 游戏页仍为项目加载占位，不是可玩游戏。
- BPM Map 尚未实现。

### 当前 Git 状态

最近提交：

- `0556470 feat: add midi debugger`
- `85e2102 init: init repo`

注意：阶段二的大量文件仍处于未提交状态。不要假设当前工作区的功能已经进入 git 历史。继续开发前先查看 `git status --short`，保留用户已有修改。

## 项目结构

```text
launchy-rhythm/
├── AGENTS.md                         # 本文档：结构、约定、进度
├── electron.vite.config.ts           # Electron main/preload/renderer 构建
├── package.json
├── tracks/                           # 开发模式 Track 数据，已忽略，不入库
└── src/
    ├── main/
    │   ├── index.ts                  # Electron 生命周期、窗口、IPC 注册
    │   ├── midi/
    │   │   └── midi-manager.ts       # CoreMIDI 封装、Launchpad 灯光
    │   └── projects/
    │       └── project-store.ts      # Track 目录、音频导入、JSON 读写
    ├── preload/
    │   ├── index.ts                  # contextBridge 暴露 window.midi / window.projects
    │   └── index.d.ts
    ├── renderer/
    │   ├── index.html
    │   └── src/
    │       ├── App.vue               # 侧边栏、页面切换、选中 Track 状态
    │       ├── assets/main.css        # 主要浅色 UI 样式
    │       ├── components/
    │       │   └── launchpad/
    │       │       └── LaunchpadGrid.vue
    │       ├── composables/
    │       │   └── useProjects.ts    # 曲库与当前项目的模块级共享状态
    │       ├── views/
    │       │   ├── LibraryView.vue
    │       │   ├── EditorView.vue
    │       │   ├── GameView.vue
    │       │   └── MidiDebugView.vue
    │       └── env.d.ts
    └── shared/
        ├── midi.ts                   # Main/Preload/Renderer 共享 MIDI 类型
        ├── project.ts                # Track、Round、ClipStep、IPC 类型
        └── game.ts                   # 游戏阶段与输入事件类型
```

`out/`、`node_modules/`、`tracks/` 都是运行时或本机数据，不应手工编辑。

## 数据模型与持久化

开发模式 Track 存储：

```text
/Users/reyar/codes/launchy-rhythm/tracks/
```

打包模式 Track 存储：

```text
Electron userData/tracks/
```

每个 Track 的目录结构：

```text
tracks/<track-id>/
├── project.json
└── audio.<ext>
```

核心类型见 `src/shared/project.ts`：

```ts
interface TrackProject {
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
```

`GameRound`：

```ts
interface GameRound {
  id: string
  prompt: TimeRange
  play: TimeRange
  steps: ClipStep[]
}
```

语义约定：

- `prompt` 是系统播放并高亮提示的示例段。
- `play` 是玩家实际操作的段落。
- `steps` 是必须按顺序完成的 Pad / clip 列表。
- `ClipStep` 同时包含时间区间和 `padNote`。
- `startSec` / `endSec` 永远表示音频中的真实秒数。
- BPM 不决定实际播放时间，只用于节拍线、吸附和推荐长度。
- Tempo Map 支持在任意 `atSec` 切换 BPM。
- 默认拍号 4/4；允许 Round 长度不是完整小节。

保存时后端会保留以下不可由前端随意覆盖的字段：

- `id`
- `audioFile`
- `sourceFileName`
- `createdAt`

并自动更新：

- `schemaVersion = 1`
- `updatedAt`

## IPC API

### 项目 API

Preload 暴露为 `window.projects`：

- `list()`：读取曲库摘要。
- `create()`：打开 macOS 音频选择器并创建 Track。
- `load(id)`：读取完整项目。
- `save(project)`：保存项目。
- `getStorageRoot()`：返回 Track 存储根目录。

Main process channel：

- `projects:list`
- `projects:create`
- `projects:load`
- `projects:save`
- `projects:get-storage-root`

### MIDI API

Preload 暴露为 `window.midi`：

- `getPorts()`
- `connect(request)`
- `disconnect()`
- `send(message)`
- `initializeLaunchpad()`
- `setPadRgb(request)`
- `setPadPalette(request)`
- `clearLaunchpad()`
- `onMessage(callback)`
- `onConnection(callback)`

Main process 事件：

- `midi:message`
- `midi:connection`

## Launchpad X 约定

当前实现使用 Launchpad X Programmer Mode。

8×8 Note 映射为：

```text
81 82 83 84 85 86 87 88
71 72 73 74 75 76 77 78
61 62 63 64 65 66 67 68
51 52 53 54 55 56 57 58
41 42 43 44 45 46 47 48
31 32 33 34 35 36 37 38
21 22 23 24 25 26 27 28
11 12 13 14 15 16 17 18
```

`LaunchpadGrid.vue` 中公式为：

```ts
note = (8 - row) * 10 + column + 1
```

端口选择建议：

- 优先选择名称包含 `Launchpad X` / `LPX` 的端口。
- 避开包含 `DAW` 的端口。
- macOS 可能枚举出多个 Launchpad 相关端口，测试台会自动推荐非 DAW 端口。

## 开发约定

- Vue 使用 `<script setup lang="ts">`。
- Main / Preload / Renderer 共享类型放在 `src/shared/`。
- 新 IPC API 需要同步更新：
  1. main handler
  2. preload 实现
  3. shared API 类型
  4. renderer `window` 类型声明
- 样式以浅色白底为主，主强调色使用 `--teal`。
- 不引入深紫蓝色主题。
- 优先做 demo 可用性，不为未知需求提前抽象。
- 修改代码后运行 Prettier。
- 提交前运行 lint、typecheck、build。
- 不要提交 `tracks/` 中的音频和谱面。

## 后续阶段规划

### 阶段三：音频引擎与 Clip 试听 — 下一步

目标：

- 从 Track 目录读取音频数据。
- 整首音频加载到内存。
- 自动读取并保存 `durationSec`。
- 按任意 `startSec` / `endSec` 试听。
- 支持播放中停止。
- 为波形绘制提供解码后的 AudioBuffer。

推荐实现：

- 通过新的项目 IPC 读取音频 `ArrayBuffer`，或注册自定义 Electron protocol 提供音频。
- Renderer 使用 Web Audio `decodeAudioData` 解码。
- 区间播放使用 `AudioBufferSourceNode.start(when, offset, duration)`。
- 可以复用已安装的 Tone，也可以直接使用 Web Audio；小 demo 更推荐直接 Web Audio，减少黑盒层。
- 所有 clip 播放控制集中放在一个 composable，例如 `useAudioEngine.ts`。
- 阶段三先不做谱面编辑 UI，只做一个可靠的时间输入 + 播放/停止测试区。

验收：

- 选择任意 Track 后能听到音频。
- 修改起止秒数后能试听对应区间。
- 时长自动写入 `project.json` 并在曲库正确显示。
- 连续点击播放/停止不产生重叠不可控的声音。

### 阶段四：手写谱面可玩纵切片

目标：

- 先允许手动编辑或生成一份简单 `rounds` 数据。
- 游戏页实现完整状态机：
  - `idle`
  - `loading`
  - `playing-track`
  - `prompting`
  - `waiting-for-input`
  - `playing-clip`
  - `resuming-track`
  - `failed`
- 示例段播放时按顺序高亮 Launchpad Pad。
- 玩家段 backing track 静音。
- 按对 Pad 播放对应 clip。
- 按错 Pad 立即失败。
- 所有步骤完成后继续播放 backing track。

验收：

- 不接 Launchpad 也能通过 UI 键盘或点击 Pad 测试核心逻辑。
- 接 Launchpad 后按 Pad 有明确灯光反馈。
- 一首手写谱面可以从头到尾完整玩通。

### 阶段五：波形制谱器

目标：

- 在制谱器中显示整首音频波形。
- 点击时间轴创建 Round / ClipStep。
- 支持拖拽或数字输入调整 `startSec` / `endSec`。
- 在 8×8 网格上选择每个 ClipStep 的 `padNote`。
- 支持选择 clip 颜色。
- 保存到 `project.json`。
- 可以试听示例段和玩家段。

验收：

- 用户可以在无 JSON 编辑经验的情况下完成一首简单谱面。
- 每个编辑中的 Round 能被重新加载。

### 阶段六：BPM Map 与节拍吸附

目标：

- 编辑 Tempo Map。
- 显示 BPM 变化点。
- 根据当前 BPM 生成节拍线。
- 支持整小节、半小节、1/4 小节长度推荐。
- 支持 BPM 在小节末尾或任意时间点切换。

验收：

- 已知 BPM 变化歌曲可以正确显示节拍线。
- 用户可以方便地把 Round 对齐到半小节或 1/4 小节。

### 阶段七：多 Track 曲库与现场模式

目标：

- 完善多 Track 切换。
- 启动时预加载所有音频。
- 现场页面隐藏制谱细节。
- 提供清晰开始、失败重试、完成反馈。
- 现场灯光效果更好看。

### 阶段八：彩排与打磨

目标：

- 用真实 Launchpad 和真实歌曲做完整彩排。
- 检查 macOS 音频延迟、Launchpad 灯光时序和 UI 尺寸。
- 打磨过场、失败反馈和成功反馈。
- 确认摆摊环境下可用。

## 已知注意事项

- `query:` 是当前工作区里一个空的未跟踪文件，疑似误生成；未确认前不要删除。
- `.DS_Store` 和 `.eslintcache` 出现在本机目录中，均已忽略或可忽略，不必纳入版本管理。
- Electron 端口如果被占用，electron-vite 会自动换端口，例如 5174；这不是错误。
- MIDI 断开后 CoreMIDI close 可能抛异常，当前实现已捕获，不需要恢复成崩溃。
- 音频文件通过选择器复制进 `tracks/`，原始路径不会保存为播放依赖。
- `durationSec` 目前默认为 0，阶段三必须用实际解码结果更新它。
