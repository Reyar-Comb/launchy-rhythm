# Launchy Rhythm 后端与 MIDI 移植速读

> 用途：把这份文档交给新的 Godot MIDI Test 项目中的 Agent，帮助其快速理解当前 Electron
> 实现，并以 Godot 4 + C# + GDExtension/RtMidi 重建最小 MIDI 链路。
>
> 基于源码快照：2026-09-15。本文不介绍 Vue 页面、CSS 或波形编辑器 UI。

## 1. 一句话架构

当前应用是 Electron 44：

```text
Launchpad X
  ↕ CoreMIDI
@julusian/midi（Electron main process）
  ↕ Electron IPC
Renderer：游戏状态机、Web Audio、灯光动画
```

真正的 MIDI 设备生命周期和协议发送位于 Electron main process；游戏状态机、输入防抖、
灯光动画数学和音频播放目前仍位于 renderer，不属于后端。

Godot MIDI Test 的最小目标应当是直接替代下面两层：

```text
@julusian/midi + Electron MIDI IPC
             ↓
Godot GDExtension + RtMidi
```

Godot C# 继续负责游戏逻辑；C++ 扩展只负责设备连接、原始 MIDI 收发和 Launchpad X 灯光协议。

## 2. 相关源码索引

```text
src/main/index.ts                         Electron 生命周期和 IPC 注册
src/main/midi/midi-manager.ts            MIDI 核心实现
src/main/projects/project-store.ts        Track 目录和 project.json 持久化
src/main/settings/settings-store.ts       MIDI/光效设置持久化
src/preload/index.ts                      main ↔ renderer API 桥
src/shared/midi.ts                        MIDI 数据契约
src/shared/project.ts                     Track/Round/Step 数据模型
src/shared/settings.ts                    设置结构、范围和默认值
src/shared/game.ts                        游戏阶段类型
docs/midi-transport-optimization.md       批量 SysEx 优化设计背景
```

依赖版本：

```text
Electron                  44.1.1
@julusian/midi             3.8.1
electron-vite              5.0.0
TypeScript                 5.9.3
```

`@julusian/midi` 底层使用 RtMidi/CoreMIDI。当前导入方式为：

```ts
import { Input, Output } from '@julusian/midi/lazy'
```

## 3. Launchpad X 核心约定

### 3.1 只使用 Programmer Mode

初始化时依次发送：

```text
Programmer Mode:
F0 00 20 29 02 0C 0E 01 F7

Programmer Layout:
F0 00 20 29 02 0C 00 7F F7
```

TypeScript 常量：

```ts
const PROGRAMMER_MODE = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, 0x01, 0xf7]
const PROGRAMMER_LAYOUT = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x00, 0x7f, 0xf7]
```

### 3.2 8×8 Pad Note 映射

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

若逻辑坐标从左下角开始且范围为 1～8：

```text
note = y * 10 + x
```

若 UI 数组从左上角开始，`row`、`column` 为 0～7：

```text
note = (8 - row) * 10 + column + 1
```

项目约定只有内圈 6×6 Pad 可以成为谱面 Note；外围一圈用于边界和特效：

```text
x ∈ [2, 7] 且 y ∈ [2, 7]
```

### 3.3 端口选择

当前端口识别规则：

```ts
const normalized = name.toLowerCase()
const isLaunchpadX = normalized.includes('launchpad x') || normalized.includes('lpx')
const isDawPort = normalized.includes('daw')
```

自动选择优先级：

1. 名称包含 `Launchpad X` 或 `LPX`；
2. 排除名称包含 `DAW` 的端口；
3. 找不到非 DAW 端口时再回退到任意 Launchpad X 端口；
4. 输入、输出分别枚举和选择，不能假定索引相同。

macOS 可能同时枚举普通 MIDI 端口和 DAW 端口。Godot 扩展也应保留这套筛选逻辑。

## 4. 当前 MIDI Manager 的行为

### 4.1 设备生命周期

`getPorts()` 每次临时创建一个 Input 和 Output，读取名称后立即销毁：

```ts
const input = new Input()
const output = new Output()
const inputs = readPorts(input, 'input')
const outputs = readPorts(output, 'output')
input.destroy()
output.destroy()
```

`connect()` 的流程：

```text
1. 先 disconnect 当前设备
2. new Input / Output
3. 验证输入输出索引
4. input.ignoreTypes(false, false, false)
5. 注册 message callback
6. input.openPort(inputIndex)
7. output.openPort(outputIndex)
8. 保存设备对象和连接状态
9. 广播 connection_changed
```

`ignoreTypes(false, false, false)` 表示不忽略 SysEx、Timing 和 Active Sensing 等消息。

`disconnect()` 和应用退出都会关闭、销毁输入输出对象。CoreMIDI 端口已经断开时，关闭操作可能抛错，
当前实现吞掉清理异常并把字段设为 `null`。

### 4.2 原始发送

`send(message)` 接受 0～255 的整数数组。发送前检查：

```text
- 已连接输出端口
- 数组非空
- 每个值都是整数
- 每个值在 0～255 内
```

然后同步调用：

```ts
output.sendMessage(message)
```

GDExtension 对应的最低层 API 应保留 `send_raw(PackedByteArray)`，便于测试未知 SysEx，
但正式灯光调用应走专用批量 API。

## 5. Launchpad X RGB SysEx

### 5.1 批量 RGB 帧格式

当前热路径已经实现一帧一条 SysEx，而不是逐灯发送：

```text
F0 00 20 29 02 0C 03
  03 <note> <red> <green> <blue>
  03 <note> <red> <green> <blue>
  ...
F7
```

字段含义：

```text
F0                              SysEx start
00 20 29                        Novation manufacturer ID
02 0C                           Launchpad X product header
03                              LED Lighting command
03                              RGB colourspec type
<note>                          LED index
<red> <green> <blue>            0～127
F7                              SysEx end
```

一条消息最多放 81 个 colourspec。每个 RGB colourspec 是 5 bytes。

```text
最大帧：7 + 81 × 5 + 1 = 413 bytes
完整 8×8：7 + 64 × 5 + 1 = 328 bytes
外围 28 灯：7 + 28 × 5 + 1 = 148 bytes
```

现有实现常量：

```ts
const SYSEX_HEADER = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c]
const LED_LIGHTING_COMMAND = 0x03
const RGB_COLOUR_SPEC = 0x03
const MAX_COLOUR_SPECS = 81
const FRAME_BUFFER_SIZE = 6 + 1 + 81 * 5 + 1 // 413
```

### 5.2 调用侧颜色是 0～255，设备侧是 0～127

项目对上层统一使用普通 RGB 0～255。写入 SysEx 时转换为 Launchpad X 的 7-bit RGB：

```ts
function clampRgb(value: number): number {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return 0
  return Math.min(127, Math.max(0, Math.round((normalized / 255) * 127)))
}
```

GDExtension API 也应让 C# 传 0～255，并只在 native 边界转换。不要让 C# 游戏代码混用
0～63、0～127 和 0～255。

### 5.3 当前批量算法

```text
1. 按 note 去重，同一 note 后写覆盖前写
2. 空数组直接成功
3. 每 81 个 Pad 分一个 chunk
4. 把 chunk 写入复用缓冲区
5. 发送该缓冲区的有效部分
```

接近原实现的伪代码：

```cpp
for each pad:
    pads_by_note[clamp(pad.note, 0, 127)] = pad

for each chunk of at most 81 pads:
    frame.clear()
    append F0 00 20 29 02 0C 03
    for each pad:
        append 03
        append note
        append rgb8_to_rgb7(red)
        append rgb8_to_rgb7(green)
        append rgb8_to_rgb7(blue)
    append F7
    midi_out.sendMessage(frame)
```

建议 GDExtension 复用 `std::array<unsigned char, 413>` 或预留容量的 `std::vector`，避免动画帧
不断分配内存。

### 5.4 单灯和调色板模式

单灯 RGB 只是批量方法的一条记录：

```text
set_pad_rgb(pad) → set_pads_rgb([pad])
```

调色板 MIDI 消息使用：

```text
steady: 90 <note> <palette>
flash:  91 <note> <palette>
pulse:  92 <note> <palette>
```

`note` 和 `palette` 均 clamp 到 0～127。

### 5.5 清屏

当前清屏构造全部 64 个 Programmer Mode Pad，并发送一条批量 RGB SysEx：

```text
for y = 1..8
  for x = 1..8
    set note(y * 10 + x) to RGB(0, 0, 0)
```

不要依赖未正式登记的特殊清屏命令；批量写黑色已经通过当前项目验证。

## 6. MIDI 输入解析

收到原始字节后：

```text
status  = raw[0]
command = status & 0xF0
channel = (status & 0x0F) + 1
data1   = raw[1] ?? 0
data2   = raw[2] ?? 0
```

分类规则：

| 条件                            | 类型             | 数据                          |
| ------------------------------- | ---------------- | ----------------------------- |
| `command == 0x90 && data2 > 0`  | Note On          | note=data1, velocity=data2    |
| `command == 0x80`               | Note Off         | note=data1, velocity=data2    |
| `command == 0x90 && data2 == 0` | Note Off         | note=data1, velocity=0        |
| `command == 0xA0`               | Poly Aftertouch  | note=data1, value=data2       |
| `command == 0xB0`               | Control Change   | controller=data1, value=data2 |
| `command == 0xD0`               | Channel Pressure | value=data1                   |
| `status == 0xF0`                | System Exclusive | 原始字节                      |
| `status >= 0xF8`                | System Realtime  | 原始字节                      |
| 其他                            | MIDI Message     | 原始字节                      |

当前事件结构：

```ts
interface MidiMessageEvent {
  receivedAt: number // Date.now()，wall clock，不是单调时钟
  deltaTime: number // @julusian/midi/RtMidi 提供
  raw: number[]
  hex: string
  type: string
  channel?: number // 对 channel message 转换为 1～16
  note?: number
  velocity?: number
  controller?: number
  value?: number
  description: string
}
```

Godot 版本建议：

- native 回调记录单调时间；
- MIDI callback 线程只复制少量数据并推入线程安全队列；
- 不要在 RtMidi/CoreMIDI callback 线程直接调用 Godot SceneTree 或 C#；
- Godot 主线程在 `_Process()` 中 drain 队列，再发 signal；
- 对 C# 暴露结构化 `note_on(note, velocity, timestamp_usec)` 和 `note_off(...)` signal；
- 同时保留一个低频调试用 `raw_message(bytes, timestamp_usec)` signal。

## 7. 输入阈值与防抖不在 MIDI Manager

下面这些行为目前属于游戏输入层，不在 main process：

```text
velocityThreshold   默认 1，范围 1～127
doublePressMs       默认 50ms，范围 0～250ms
outerRingFadeMs     默认 500ms，范围 0～2000ms
```

输入触发约定：

```text
- 只有 velocity >= velocityThreshold 的 Note On 才触发游戏输入
- 同一个 Pad 在 doublePressMs 内重复触发会被忽略
- 不同 Pad 互不影响
- Note Off 仍需传给游戏逻辑，用于多押未凑齐时的错误判断
```

在 Godot 中，这些应留在 C# `InputJudge` 或 `GameSession`，不要塞进 GDExtension。扩展应如实上报
原始设备事件，避免 MIDI 层和游戏规则耦合。

## 8. 建议的 GDExtension 最小 API

第一版只做一个 Godot 类，例如 `LaunchpadMidi`：

```text
LaunchpadMidi : RefCounted 或 Node

Methods
  get_ports() -> Dictionary
  connect(input_index: int, output_index: int) -> Dictionary
  disconnect() -> void
  is_connected() -> bool
  initialize_launchpad() -> bool
  send_raw(bytes: PackedByteArray) -> bool
  set_pad_rgb(note: int, red: int, green: int, blue: int) -> bool
  set_pads_rgb(pads: Array[Dictionary]) -> bool
  set_pad_palette(note: int, color: int, mode: int) -> bool
  clear_launchpad() -> bool
  poll() -> void                    // 主线程调用，派发队列

Signals
  note_on(note, velocity, channel, timestamp_usec)
  note_off(note, velocity, channel, timestamp_usec)
  midi_message(bytes, timestamp_usec)
  connection_changed(connected, input_name, output_name, error)
```

为了减少 Variant/Dictionary 热路径成本，稳定后可以给 `set_pads_rgb` 改为紧凑数组：

```text
PackedInt32Array: [note, r, g, b, note, r, g, b, ...]
```

第一版最多 64 灯、约 30Hz，Dictionary 版本也足以验证硬件。先以正确和易调试为主。

## 9. Electron MIDI IPC 契约（用于行为对照）

当前 main process 注册：

```text
midi:get-ports
midi:connect
midi:disconnect
midi:send
midi:initialize-launchpad
midi:set-pad-rgb
midi:set-pads-rgb
midi:set-pad-palette
midi:clear-launchpad
```

广播事件：

```text
midi:message
midi:connection
```

请求结构：

```ts
interface ConnectMidiRequest {
  inputIndex: number
  outputIndex: number
}

interface PadRgbRequest {
  note: number
  red: number
  green: number
  blue: number
}

interface PadRgbBatchRequest {
  pads: PadRgbRequest[]
}

interface PadPaletteRequest {
  note: number
  color: number
  mode?: 'steady' | 'flash' | 'pulse'
}
```

Godot Test 项目不需要复刻 Electron IPC；只需保持这些 API 的行为和颜色语义，方便以后迁移游戏代码。

## 10. Track 项目后端

### 10.1 存储目录

```text
开发模式：<Electron app path>/tracks
打包模式：<Electron userData>/tracks
```

当前开发机路径是：

```text
/Users/reyar/codes/launchy-rhythm/tracks/
```

每个 Track：

```text
tracks/<track-id>/
├── project.json
└── audio.<ext>
```

当前支持导入：

```text
mp3 wav m4a aac flac ogg
```

导入流程：

```text
1. Electron 原生文件选择器选音频
2. ID = 文件名 slug + UUID 前 8 位
3. 建立 Track 目录
4. 原音频复制成 audio.<原扩展名>
5. 写入默认 project.json
```

### 10.2 Track 数据模型

```ts
interface TrackProject {
  schemaVersion: 1
  id: string
  title: string
  artist?: string
  audioFile: string
  sourceFileName: string
  audioStartSec: number
  audioEndSec: number | null
  durationSec: number
  createdAt: string
  updatedAt: string
  tempoMap: TempoPoint[]
  rounds: GameRound[]
  editor?: { gridOffsetMs: number }
}

interface TempoPoint {
  atSec: number
  bpm: number
}

interface GameRound {
  id: string
  prompt: TimeRange
  play: TimeRange
  revealAtSec?: number
  steps: ClipStep[]
}

interface TimeRange {
  startSec: number
  endSec: number
}

interface ClipStep extends TimeRange {
  id: string
  padNotes?: number[]
  padNote?: number // 旧数据兼容字段
  color: { red: number; green: number; blue: number }
  hitEffect?: 'cross' | 'corner' | 'burst' | 'rice'
}
```

关键语义：

- 所有时间都是原音频中的绝对秒数；
- `prompt` 是系统示例段，`play` 是玩家输入段；
- `revealAtSec` 是 Prompt 内允许提前输入和显示全部目标的时点；
- `padNotes` 支持双押/多押；
- 老项目可能只有 `padNote`，读取时应规范化为数组；
- Step 的 `startSec/endSec` 代表亮灯时间；
- 实际音频切片结束时间是下一 Step 的 `startSec`，最后一步结束于 `round.play.endSec`；
- `color` 使用 0～255；
- BPM 只用于网格和吸附，不决定真实播放时间。

### 10.3 保存保护

保存时前端不能覆盖以下已有字段：

```text
id
audioFile
sourceFileName
createdAt
```

后端强制：

```text
schemaVersion = 1
updatedAt = 当前 ISO 时间
```

Track ID 只允许 Unicode 字母、数字、下划线和连字符：

```regex
^[\p{Letter}\p{Number}_-]+$
```

音频读取前要求 `audioFile` 必须是纯文件名，不能包含目录，用来阻止路径穿越。

## 11. 当前音频后端实际做了什么

Electron 后端目前只做：

```text
1. 根据 Track ID 读取 project.json
2. 校验 audioFile 是纯文件名
3. readFile 读取完整音频
4. 通过 IPC 返回 Uint8Array/Buffer
```

后端当前没有做：

```text
- MP3 解码
- WAV 切片生成
- 音频播放
- seek
- 淡入淡出
- backing/clip 混音
```

这些现在由 renderer 的 Web Audio 实现。因此新的 Godot 项目不能从 main process 找到可直接移植的音频引擎。

未来建议保留：

```text
audio.mp3             backing track
clips/*.wav           制谱器预生成的低延迟 Step 切片
project.json          谱面绝对时间 + clip 文件引用
```

但截至本文快照，`clips/*.wav` 和 `clipAudioFile` 尚未实现。

## 12. 设置持久化

设置文件：

```text
Electron userData/app-settings.json
```

结构：

```json
{
  "playfieldEffects": {
    "playfieldBackgroundBrightness": 18,
    "rippleDurationMs": 200,
    "rippleRadius": 5,
    "rippleWidth": 0.38,
    "rippleFade": 0.2,
    "rippleThreshold": 0.05,
    "rippleGain": 2.8,
    "rippleBrightness": 2
  },
  "midiInput": {
    "velocityThreshold": 1,
    "doublePressMs": 50,
    "outerRingFadeMs": 500
  }
}
```

读取时所有数字都会限制到范围内：

| 设置          |      范围 |
| ------------- | --------: |
| 背景亮度      |     0～64 |
| 射线时长      | 80～600ms |
| 射线半径      |    1.5～5 |
| 波头宽度      |  0.2～1.2 |
| 衰减          | 0.05～0.9 |
| 阈值          | 0.02～0.3 |
| 增益          |      1～5 |
| 效果亮度      |    0.2～3 |
| MIDI 力度阈值 |    1～127 |
| 同 Pad 防抖   |  0～250ms |
| 外圈渐亮      | 0～2000ms |

Godot MIDI Test 第一阶段只需力度阈值和防抖；这两项不应进入 native 扩展。

## 13. 当前游戏状态类型

```text
idle
loading
playing-track
prompting
waiting-for-input
playing-clip
resuming-track
failed
```

这些状态当前不是 Electron main process 的职责。Godot 正式玩家端应在 C# 重建状态机，
GDExtension 不应感知 Round、Step、正确/错误或音频状态。

## 14. 已知限制和移植风险

### MIDI 层当前缺少

- 自动热插拔；
- 周期性端口重扫；
- 自动重连；
- 独立健康探测；
- 发送队列和 latest-wins 节流；
- 原生错误回调上报。

### RtMidi/CoreMIDI 特别注意

当前 Node 绑定下，CoreMIDI `MIDISend` 的部分失败可能只通过 RtMidi warning 输出到 stderr，
不一定抛异常。因此“函数返回成功”不能完全证明 USB 设备仍然收到灯光。

GDExtension 应尽量：

```text
- 注册 RtMidi error callback
- 把 native 错误排队送到 Godot 主线程
- 设备拔出时更新 connected 状态
- 重连后重新发送 Programmer Mode 和完整灯光快照
```

### 线程模型

RtMidi/CoreMIDI 输入回调不在 Godot 主线程。禁止在回调中：

```text
- emit_signal
- 操作 Node
- 调用 C# managed 对象
- 更新场景或灯光 UI
```

安全路径：

```text
CoreMIDI callback
  → lock-free queue / mutex-protected queue
  → Godot main thread poll
  → emit signal
  → C# GameSession
```

### 退出顺序

建议：

```text
1. 停止接受新的输出任务
2. 清屏（设备仍连接时）
3. 停止输入 callback
4. drain/丢弃事件队列
5. close input/output ports
6. destroy RtMidi objects
7. 销毁 GDExtension instance
```

## 15. Godot MIDI Test 验收顺序

不要一开始接游戏状态机。按下面顺序逐步验证：

### A. 扩展加载

```text
- Godot 能识别 .gdextension
- C# 能实例化 LaunchpadMidi
- Debug/Release 路径正确
- Apple Silicon arm64 正确加载
```

### B. 端口

```text
- 分别列出 input/output
- 显示完整端口名和索引
- 标记 Launchpad X 和 DAW 端口
- 自动推荐非 DAW input/output
```

### C. 输入

```text
- Note On
- Note Off
- velocity=0 的 Note On 转 Note Off
- Poly Aftertouch
- Control Change
- 快速连续按不同 Pad
- 快速重复按同一个 Pad
```

### D. 输出

```text
- 进入 Programmer Mode
- 点亮单 Pad
- 一条 SysEx 点亮 64 Pad
- RGB 255 正确转换成 127
- 调色板 steady/flash/pulse
- 一条批量帧清屏
```

可用的精确帧断言：

```text
输入：
  note 11 = RGB(255, 0, 0)
  note 12 = RGB(0, 255, 255)

期望 SysEx：
F0 00 20 29 02 0C 03
03 0B 7F 00 00
03 0C 00 7F 7F
F7
```

### E. 稳定性

```text
- 30Hz 发送 64 Pad 批量帧，持续 2 分钟
- 快速按键期间仍持续发灯
- 拔出设备不崩溃
- 重新插入、重连、重新初始化
- 退出时清屏且无 native crash
```

## 16. 新 Agent 的实现边界

第一轮只实现：

```text
Godot 4 .NET 测试项目
godot-cpp GDExtension
RtMidi/CoreMIDI
端口枚举
输入输出连接
原始消息输入
Programmer Mode
单灯和批量 RGB
清屏
C# 测试场景
```

明确暂不实现：

```text
正式游戏 UI
波形制谱器
音频播放
Round 状态机
WAV 切片生成
复杂灯光特效
跨平台二进制
protobuf 或本地进程通信
```

建议先只构建当前开发机的 macOS arm64 Debug 版本，实机跑通后再补 Release 和 Universal Binary。

## 17. 最重要的五条结论

1. Launchpad X 必须先发送 Programmer Mode 和 Programmer Layout 两条 SysEx。
2. 上层颜色统一为 0～255，native 发送边界映射为 0～127。
3. RGB 灯光要把最多 81 个 colourspec 打包进一条 SysEx，不能逐灯发送。
4. RtMidi 输入 callback 不能直接触碰 Godot/C#；必须经线程安全队列回到主线程。
5. MIDI 扩展只处理硬件，不处理防抖、游戏判定、音频和动画。
