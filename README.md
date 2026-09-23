# Launchy Rhythm 制谱说明

## 快速开始

```bash
npm install
npm run dev
```

应用启动后直接进入“歌曲库”。选择 **新建 Track** 导入音频，导入完成后进入制谱器。

Launchpad X 是可选硬件：没有 MIDI 设备时，制谱、波形编辑、Autoplay 和网页 8×8 Pad 仍可使用；Real test 可以使用网页 Pad 模拟输入。

## 制谱流程

1. 在歌曲库新建 Track，选择 MP3、WAV、M4A、AAC、FLAC 或 OGG。
2. 程序复制原始音频到 Track 目录，并尝试读取 MP3 内嵌封面。
3. 没有内嵌封面时，再查找音频同目录的同名图片、`cover` 或 `folder` 图片。
4. 封面统一保存为 `cover.png`，尺寸为 512 × 512。
5. 进入制谱器，先确认歌曲标题、BPM、音频起止区间。
6. 使用 Round 工具在波形上拖出示例段和游玩段。
7. 使用 Note 工具在示例段点击或拖拽创建 Note。
8. 在 Pad 面板选择内圈 Pad、颜色和命中特效。
9. 使用 Reveal 工具设置可选的提前全亮事件。
10. 用 Autoplay 或网页 Pad 进行预览，最后点击保存工程。

## Round / Note 规则

- `Prompt` 是系统示例段：播放原曲并按 Note 顺序亮灯。
- `Play` 是玩家输入段：原曲静音，等待按键。
- Prompt 和 Play 必须等长，Play 必须接在 Prompt 后面。
- Note 必须位于 Play 段对应时间范围内，Note 之间不能重叠。
- 一个 Note 可绑定多个内圈 Pad；双押 / 多押必须全部按下才算完成。
- 错误输入累计 3 次后失败。
- Reveal 未设置时，目标默认在 Play 开始时全亮，并保留默认提前输入窗口。
- BPM Map 用于节拍网格、吸附和编辑器显示，不改变音频播放速度。

## 时间轴和交付文件

制谱器使用原始音频绝对时间戳。保存时，程序使用本机 FFmpeg 把选定区间裁剪成运行时音频，并生成相对时间轴：

```text
Track 目录/
├── audio.mp3       # 裁剪后的运行时音频，从 0 秒开始
├── cover.png       # 512 × 512 封面
└── project.json    # 原始时间轴 + 运行时导出谱面
```

`project.json` 中：

- `rounds` / `tempoMap`：编辑器原始绝对时间轴。
- `runtimeRounds` / `runtimeTempoMap`：运行时相对时间轴。
- `runtimeDurationSec`：裁剪后音频长度。
- `sourceAudioFile`：本地继续编辑时使用的原始音频；正式交付可不携带。

最终复制到另一台客户端时，带上整个 Track 文件夹中的：

```text
audio.mp3
cover.png
project.json
```

正式客户端不需要原始音频，也不需要 Launchpad 才能启动、编辑或预览。

## Windows 注意事项

- 使用 Windows 安装包后，Track 数据存放在 Electron 的 userData `tracks` 目录中。
- FFmpeg 必须能被应用进程找到；开发环境通常需要把 `ffmpeg` 放入系统 PATH。
- 没有 MIDI 设备时，MIDI 连接失败只显示为硬件不可用，不影响歌曲库和制谱器。
- `tracks/`、`out/`、构建产物、临时 FFmpeg 文件和本机配置不会提交到 Git。

更多字段和运行机制见 [`docs/track-package-format.md`](docs/track-package-format.md)。
