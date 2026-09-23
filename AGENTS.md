# Launchy Rhythm 开发说明与进度快照

> 更新时间：2026-09-12
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
- 音频：直接使用 Web Audio API；`tone` 仍在依赖中但当前未使用
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
- 新建 Track 后会弹出“设置音频播放区间”窗口，支持起终点数字输入、拖拽滑杆和 8 秒试听；确认后写入 `audioStartSec` / `audioEndSec` 并进入制谱器。
- 自动生成 Track ID，支持中文文件名。
- 生成默认 `project.json`。
- 曲库真实读取。
- 曲库卡片显示标题、艺术家、BPM、播放区间、Round 数、更新时间和源文件名。
- 制谱器基础信息编辑：标题、艺术家、初始 BPM、音频起点和音频终点。
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

- 尚未实现波形展示。
- BPM Map 尚未实现。

### 阶段三：音频引擎与 Clip 试听 — 已完成

已完成：

- Main process 通过 `projects:read-audio` 读取 Track 目录中的完整音频。
- Renderer 接收 `Uint8Array` 并用 `AudioContext.decodeAudioData` 解码整首音频。
- 解码后的 `AudioBuffer` 保存在模块级共享状态中，供制谱器和游戏页复用。
- 支持任意 `startSec` / `endSec` 区间播放、播放中停止、重复播放不叠加。
- 播放区间开头支持 0.6s 线性淡入，到达终点或进入下一个 Prompt 前支持 0.6s 线性淡出；淡入淡出时长会按播放区间自动截断，不会覆盖超过区间一半。
- 自动读取音频时长并保存到 `project.json`；保存失败时也会先用解码时长驱动当前 UI。
- 播放结束回调可区分自然结束和手动停止，供游戏状态机使用。
- 离开制谱器页面时释放 `AudioContext`。
- 制谱器提供区间试听面板。

阶段三关键文件：

- `src/renderer/src/composables/useAudioEngine.ts`
- `src/main/projects/project-store.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/src/views/EditorView.vue`

### 阶段四：可玩纵切片 — 已完成，用户已确认基本功能正确

已完成：

- 制谱器阶段四曾提供 Round JSON 编辑和测试 Round 生成，用于快速验证数据模型。
- 游戏页实现状态机：
  - `idle`
  - `loading`
  - `playing-track`
  - `prompting`
  - `waiting-for-input`
  - `playing-clip`
  - `resuming-track`
  - `failed`
- 示例段播放时按 step 数量均分时间并依次点亮 Pad。
- 玩家段开始后 backing track 静音，只等待 Pad 输入。
- 按对 Pad 播放对应 clip，全部按对后从 `play.endSec` 续播原曲。
- 有下一个 Round 时续播到下一个 `prompt.startSec`，然后进入下一轮。
- 按错立即失败，错误 Pad 红灯、正确 Pad 橙灯，并在 UI 中提示。
- 游戏页自动推荐并连接非 DAW 的 Launchpad X 输入输出端口。
- 无硬件时可用 UI 8×8 Pad 或 step chip 测试；有硬件时接收 Note On 输入。
- 游戏页显示 Round / Step 进度、当前阶段、Launchpad 连接状态和结果。

阶段四关键文件：

- `src/renderer/src/composables/useGameEngine.ts`
- `src/renderer/src/views/GameView.vue`
- `src/renderer/src/views/EditorView.vue`
- `src/renderer/src/components/launchpad/LaunchpadGrid.vue`
- `src/shared/game.ts`

已通过验证：

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- Electron 开发模式启动无报错

用户验收结果：

- 基本功能正确，可以进入更直观的波形制谱器阶段。

### 阶段五：波形制谱器 — 已实现，待用户实际上手验收

已完成：

- 新增 `WaveformEditor` 大块 Canvas 波形视图。
- 波形支持按钮缩放、整首视图，以及总览进度条拖拽平移。
- 根据 `tempoMap` 绘制 BPM 网格，支持 BPM 变化点。
- 制谱器提供 BPM 工具：输入新 BPM 后点击波形即可在毫秒级位置添加变速点；波形显示橙色标记，变速点列表支持精确修改时间、修改 BPM 和删除，后续 Grid 会立即按新 BPM 重排，并随项目保存。
- 网格密度可选：1/4、1/8、1/16、1/32 拍。
- Round 工具支持拖拽创建示例段，并自动生成紧随其后的等长游玩段。
- Note 工具支持在示例段点击或拖拽创建 Note，自动镜像到游玩段。
- Note 创建时使用当前选中的 Pad 与颜色。
- 制谱页波形独占整行宽度；波形下方左侧是 Pad 与颜色选择器，右侧是 Round 选择器，再右侧是 Reveal 与 Note 编辑面板。
- 制谱页 Round 选择器使用紧凑单行卡片，只显示序号、时长、Note 数和 Reveal 标记；聚焦、试听示例段、试听游玩段、删除保留为小按钮。
- 制谱页提供 Note 列表：数字编辑起止时间、试听、删除。
- 制谱页提供 8×8 Pad 选择器和固定调色盘。
- Edit Grid 支持 ms 级网格偏移调整，并影响网格显示与吸附。
- Edit Grid 偏移保存在 `project.json` 的 `editor.gridOffsetMs` 中，保存项目后重新打开不会丢失。
- 波形下方总览条左右两侧有长按方向按钮；按住时按当前视图长度约 1% 的步进慢速平移时间轴。
- Note 工具支持右键选中已有 Note，选中后拖动前后边缘伸缩，并自动同步示例段和游玩段镜像。
- 选中的 Note 再右键一次即可删除；左键不会再隐式选中 Note。
- 在波形上右键任意 Round 的示例段或游玩段区域可直接选中该 Round；Note 工具下命中 Note 时仍优先执行 Note 选中 / 删除逻辑。
- 选中 Note 后，右侧 Pad 面板会切换为编辑该 Note 的绑定；普通点击替换绑定，Cmd/Ctrl/Shift 点击增删绑定。
- 未选中 Note 时，右侧 Pad 面板选择的是下一个新 Note 的默认绑定。
- Note 只能绑定 8×8 最外围一圈以内的 6×6 内圈 Pad；外围一圈在编辑器中禁用并弱化显示。
- 一个 Note 可绑定多个 Pad（双押 / 多押）；按住 Cmd/Ctrl/Shift 后点击内圈 Pad 可以增减绑定。
- 保存与预览校验会拒绝空 Pad、重复 Pad、外围 Pad 和时间重叠的不同 Note。
- 保存前校验示例/游玩等长、游玩段位置、Note 在游玩段内、Pad 有效。
- 当前谱面预览支持从任意时间点开始，并提供 Autoplay / Real test 两种模式。
- Real test / 正式游戏支持快速接续输入：当前 clip 播放期间可以按下一个正确 Pad，新按键会立即截断旧 clip 并播放下一步。
- 同一个 Pad 重复触发有可配置防抖，避免硬件双击导致一个物理动作被记作两次输入。
- Programmer Mode Note On 力度阈值可配置，低于阈值的 Note On 不触发。
- 触发阈值、防抖时间和外圈提前渐亮时长在 MIDI 测试台配置，并通过 Electron userData 中的 `app-settings.json` 持久化；设置同时影响测试台、制谱器 Real test 和正式游戏。
- 外圈提前渐亮时长范围为 0–2000ms，默认 500ms。
- 双押 / 多押必须凑齐当前 Note 绑定的全部 Pad 才播放 clip；只按住其中一部分时先等待凑齐，若松开时仍未凑齐则按错误处理，红闪后恢复该序列 Pad 常亮。
- 按错 Pad 不再立即失败：错误 Pad 红色闪烁约 220ms；play 阶段未完成序列 Pad 恢复常亮，非序列内圈 Pad 恢复低亮度背景、外圈恢复黑，不保留暗红；同一局累计 3 次错误才失败。
- 示例段播放时，每个 Note 只在自己的触发时间范围内点亮，进入下一个 Note 前熄灭。
- 示例段阶段的 Note 使用谱面自身颜色和归一化后的最高亮度显示；play 阶段未完成 Note 统一使用独立的青色常亮，避免和 Prompt 读谱颜色混淆。
- 玩家输入阶段点亮外围一圈作为游玩区域边界，同时点亮该 Round 未完成 Note 的 Pad。
- Prompt 一开始，6×6 内圈中没有目标的 Pad 就会显示极低亮度白色背景；Play / Reveal 后继续保持该背景，目标 Pad 仍使用高亮青色。
- 外围一圈的 Play 边界和预告特效使用蓝/白体系；成功 / 错误反馈分别使用绿色 / 红色例外。
- 外围一圈预告从深蓝渐变到明确的高亮蓝色；Reveal / Play 后的常亮外圈使用同一最终蓝色，不再落回淡蓝白色。
- Round 支持 `revealAtSec` 显式 Reveal 事件。设置该 tag 时，到达事件点即把全部未完成 Play 目标切换为 Play 青色常亮并开放提前输入。
- 未设置 Reveal 时，Play 目标默认到 `play.startSec` 才全亮；但真实游玩仍保留一个很小的提前输入窗口，从示例段最后一拍进行到 25% 处开始。
- 外围一圈从 Reveal / Play 开始点往前按配置的渐亮时长开始变亮；早于 Prompt 起点则截断到 Prompt 起点。Prompt Note 本身不做亮度渐变。
- Round 长度不是 4 拍时，预告同样固定从 `play.startSec` 前一拍开始；如果示例段短于一拍，则从示例段起点开始。
- play 阶段不做 BPM 心跳；正式游戏每次正确完成一个 Note，会触发一次约 340ms 的外围流动，按错同样触发外围流动。外围底色保持深蓝色，成功的高亮度流动元素为绿色，错误为红色；流动从每条边的中心同时向两侧角落扩散，波峰更锐、速度更快。
- 提前输入窗口内正确按下不会截断示例原曲，而是在独立 clip 音频通道上叠加播放对应切片。若玩家在 Prompt 自然结束前完成整个 Round，程序会等示例段自然播完再续播后续原曲。
- 连续亮度动画通过 Programmer Mode RGB SysEx 实现，渲染侧使用 0–255 颜色，main 侧映射到 Launchpad X 的 0–127，并以约 30Hz 批量更新外圈和内圈流动特效。
- 已按 `docs/midi-transport-optimization.md` 落地传输优化：`setPadsRgb` 会把最多 81 个 RGB colourspec 打包成一条 SysEx，并复用同一块 Buffer；`setPadRgb` 内部转走批量路径。
- `clearLaunchpad` 从 64 条 Note On 改为一条 64-pad 批量 RGB SysEx。
- 游戏引擎的常亮、绿闪、红闪和失败提示等热路径已改为一次 `setPadsRgb` 批量发送，不再循环逐灯发 IPC。
- Renderer 侧 RGB 颜色语义统一为 0–255；main 侧统一映射为 Launchpad X 的 0–127。此前混用 0–63 / 0–127 导致最高亮度被截断的问题已修正。
- 正确完成一个 Note 时，对应 Pad 在实体机上有约 180ms 绿色闪光后熄灭，界面 Pad 也有放大绿色闪光；只有正确命中才会让序列 Pad 消失。
- 正确完成一个 Note 时，会在内圈触发一次默认约 200ms 的十字高速流动射线；命中点先短促爆亮，高亮波头以缓动方式向外冲出，波头后方接指数衰减拖尾，避开当前目标 Pad、绿闪 / 红闪 Pad 和外圈，避免覆盖读谱信息。
- Note 命中特效支持四种模式：`cross` 十字射线、`corner` 四角斜向射线、`burst` 命中 Pad 周围 3×3 爆炸、`rice` 米字型八方向射线；旧谱面未写 `hitEffect` 时默认 `cross`。
- 制谱器的“Pad 与颜色”面板可为选中 Note 修改命中特效；未选中 Note 时该选择用于新创建 Note。Note 列表会显示当前特效。
- 每次 Note 命中都会创建一个独立的射线动画实例；新命中不会终止上一条尚未结束的射线，所有射线共享同一个约 30Hz 渲染循环。
- 每次命中会从红色、深蓝色、黄色这三个高对比颜色中随机取波头颜色和拖尾颜色；双押 / 多押的同一次命中共享同一组颜色。调色盘已避开 Play 常亮青色、白色、绿色等容易干扰目标的颜色。拖尾颜色按“波头到起点的距离”连续渐变，同一次特效内也能看到色彩过渡。多个仍在生效的射线会按颜色贡献加权叠加，强度先叠加再软饱和，交叉位置会更快达到高亮，不会线性溢出。
- 十字射线、四角射线、3×3 爆炸和米字型射线共用一个“击打特效亮度”倍率，可在 0.2–3× 之间统一调节。特效全部自然结束后才恢复内圈低亮度背景。
- 内圈低亮度背景保持静态白色，不随 BPM 波动，也不会覆盖目标 Pad、绿闪 / 红闪和射线。
- 游玩光效参数在 MIDI 测试台的“游玩光效配置”中调整，并通过 Electron userData 中的 `app-settings.json` 持久化。可配置项包括背景白色亮度、射线时长、射线距离、头部宽度、衰减、触发阈值、射线增益和击打特效亮度；这些设置立即影响游戏页、制谱器 Real test 以及网页 8×8 预览。
- Play 阶段闪灯结束后会按当前 Round 的全部未完成目标整批重绘青色常亮，只把“当前命中且之后不再出现”的 Pad 恢复为背景，避免双押 / 多押或快速连打时待完成 Pad 被后续灯光消息吞掉。
- 如果同一个 Pad 在当前 Round 内还有后续 Note，命中当前 Note 的绿闪结束后会恢复该 Pad 的 Play 青色常亮；只有该 Pad 在当前 Round 的最后一次 Note 命中后才熄灭。
- Note 的 `startSec` / `endSec` 表示 Prompt 和 play 阶段的亮灯时间；音频切片运行时自动推导为“当前 Note 开始到下一个 Note 开始”，最后一个 Note 播到 `play.endSec`。制谱器的单个 Note 试听使用同一规则。
- 波形编辑器支持空格播放 / 暂停整首音频，并在波形和总览条上显示移动播放头。
- 普通空格播放只走 Web Audio，不发送 MIDI，也不改变 Launchpad 灯光。
- 波形工具栏新增 Move 模式；在波形上点击会把该位置设为当前播放起点，并显示橙色虚线起点标记。
- 空格从当前播放起点播放；播放中再次按空格会停止并回到该起点。
- 暂停语义调整为“回到 Move 起点”；自然播放结束后再次按空格也会从当前起点播放。
- 如果谱面预览正在进行，按空格会先停止预览，再切换到普通波形播放。
- 播放接近可视区域右边缘时，波形视图会自动平移以保持播放头可见。
- 制谱器新增撤销按钮和 `⌘Z` / `Ctrl+Z` 快捷键，保留最近 50 次谱面编辑历史。
- 波形编辑器新增 Reveal 工具；在选中 Round 的 Prompt 区间点击可设置 `revealAtSec`，侧栏支持数字编辑和清除。
- 撤销覆盖 Round / Note 的创建、删除、拖拽伸缩、数字时间编辑、Reveal 设置、选中 Note 的 Pad 绑定修改和命中特效修改。

阶段五关键文件：

- `src/renderer/src/components/editor/WaveformEditor.vue`
- `src/renderer/src/views/EditorView.vue`
- `src/renderer/src/assets/main.css`
- `src/renderer/src/composables/useMidiInput.ts`
- `src/renderer/src/composables/useGameEngine.ts`
- `src/shared/project.ts`

已通过验证：

- `npm run lint`
- `npm run typecheck`
- `npm run build`

待用户验收：

- 选择现有 Track，在波形上拖出 Round。
- 切换 Note 工具，在示例段创建多个不同 Pad / 颜色的 Note。
- 检查游玩段中的镜像 Note 与数字编辑、试听、删除功能。
- 保存后重新进入制谱器确认数据仍存在。
- 修改 Edit Grid、保存并重新打开，确认网格偏移仍存在。
- 长按总览条左右按钮，确认时间轴按当前缩放比例慢速移动。
- 右键 Note 选中，拖动前后边缘伸缩；选中后在右侧 Pad 面板修改绑定；再右键一次删除。
- 创建一个绑定两个内圈 Pad 的 Note，分别测试只按一个、按错一个和按齐两个的行为。
- 连续按错三个不同 Pad，确认前两次只红闪并继续，第三次才结束并显示失败。
- 检查示例段灯效只覆盖 Note 自身时间段；输入阶段外围一圈和未完成 Note Pad 常亮；完成输入有绿色闪光。
- 不设置 Reveal 时，检查 Play 开始前目标 Pad 不提前全亮，但最后一拍进行到 25% 后可以提前按第一个正确 Pad；提前按错仍按错误计数处理。
- 设置 Reveal tag 后，检查目标 Pad 全亮和提前输入都从 tag 时间开始。
- 调整 MIDI 测试台中的外圈提前渐亮时长，确认外圈动画起点和时长符合配置。
- 在波形上点击设置 Reveal，测试侧栏数字编辑、清除和撤销；保存后重新加载确认 `revealAtSec` 仍存在。
- 在制谱器按空格播放 / 停止，确认波形和总览条播放头移动，停止后回到当前 Move 起点。
- 播放到可视区域右侧时确认波形自动跟随；同时确认普通空格播放不会触发 Launchpad 灯光。
- 在谱面预览进行中按空格，确认预览停止并切换为普通音频播放。
- 切到 Move 工具点击波形任意位置，确认橙色起点标记和当前时间更新；空格播放后再次按空格应回到该起点。
- 创建、删除、拖拽伸缩 Note / Round，修改 Note 数字时间或 Pad 绑定后，用按钮和 `⌘Z` 分别确认撤销行为。
- 到游戏页试玩真实波形谱面。
- 用实体 Launchpad X 测试快速连续按不同 Pad、同一个 Pad 快速重复按、低力度按压和错误 Pad。
- 用实体 Launchpad X 目测批量 SysEx 后的清屏、外圈渐亮、Reveal 全亮、命中绿闪、错误红闪和四边扩散流动；重点确认颜色统一后是否过曝。

### 当前 Git 状态

最近提交：

- `c85eef9 feat:add project model`
- `0556470 feat: add midi debugger`
- `85e2102 init: init repo`

注意：阶段三已进入 `c85eef9`；阶段四音频引擎、游戏纵切片和阶段五波形制谱器当前在工作区未提交。继续开发前先查看 `git status --short`，保留用户已有修改。

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
    │   └── settings/
    │       └── settings-store.ts     # 测试台与游玩光效设置持久化
    ├── preload/
    │   ├── index.ts                  # contextBridge 暴露 window.midi / window.projects
    │   └── index.d.ts
    ├── renderer/
    │   ├── index.html
    │   └── src/
    │       ├── App.vue               # 侧边栏、页面切换、选中 Track 状态
    │       ├── assets/main.css        # 主要浅色 UI 样式
        │       ├── components/
        │       │   ├── editor/
        │       │   │   └── WaveformEditor.vue
        │       │   └── launchpad/
        │       │       └── LaunchpadGrid.vue
        │       ├── composables/
        │       │   ├── useAudioEngine.ts # Web Audio 解码与区间播放
        │       │   ├── useGameEngine.ts  # 游戏状态机与 Pad 输入判定
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
  audioStartSec: number
  audioEndSec: number | null
  durationSec: number
  createdAt: string
  updatedAt: string
  tempoMap: TempoPoint[]
  rounds: GameRound[]
  editor?: TrackEditorSettings
}
```

`TrackEditorSettings`：

```ts
interface TrackEditorSettings {
  gridOffsetMs: number
}
```

`GameRound`：

```ts
interface GameRound {
  id: string
  prompt: TimeRange
  play: TimeRange
  revealAtSec?: number
  steps: ClipStep[]
}
```

语义约定：

- `prompt` 是系统播放并高亮提示的示例段。
- `play` 是玩家实际操作的段落。
- `revealAtSec` 是可选的 Prompt 段内显式事件；设置后目标全亮和提前输入都从该时间开始，未设置则目标在 Play 开始时全亮、只保留默认小窗口提前输入。
- `steps` 是必须按顺序完成的 Pad / clip 列表。
- `ClipStep` 同时包含时间区间和 `padNotes`；`padNotes` 是数组，因此天然支持双押 / 多押。
- `ClipStep.hitEffect` 可选，取值为 `cross` / `corner` / `burst` / `rice`，分别表示十字射线、四角斜向射线、3×3 爆炸和米字型八方向射线；未设置时默认 `cross`。
- `ClipStep.startSec` / `endSec` 表示 Note 的亮灯时间；实际音频切片结束时间在运行时推导为下一个 Note 的 `startSec`，最后一个 Note 为 `round.play.endSec`。
- 旧项目的 `padNote` 字段仍作为兼容输入读取；制谱器加载时会规范化为 `padNotes`，保存时写回单一 `padNotes` 字段。
- 可作为 Note 的 Pad 只包括 8×8 最外围一圈以内的 6×6 内圈；`OUTER_RING_PAD_NOTES` 和 `isPlayablePadNote()` 定义该规则。
- 不同 Note 的时间不允许重叠；同一个 Note 内的 Pad 不允许重复。
- `startSec` / `endSec` 永远表示音频中的真实秒数。
- `audioStartSec` 表示正式游戏的起始绝对时间；新建弹窗和制谱器基础信息都可修改，正式游戏 `start()` 从该点开始。
- `audioEndSec` 表示正式游戏允许播放到的绝对时间；`null` 表示完整音频末尾。新建弹窗会显式写入终点，制谱器可以修改或恢复为完整音频末尾。
- 正式游戏和制谱器空格播放都限制在 `[audioStartSec, audioEndSec]` 内；Round 必须完整落在该播放区间内，终点之后不会再续播原曲。
- 从 `audioStartSec` 到第一个 Round Prompt 的 backing track 会自动淡入并在进入 Prompt 前淡出；最后一个 Round 后会续播到 `audioEndSec` 再淡出结束。
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
- `readAudio(id)`：读取完整音频文件数据。
- `save(project)`：保存项目。
- `getStorageRoot()`：返回 Track 存储根目录。

Main process channel：

- `projects:list`
- `projects:create`
- `projects:load`
- `projects:read-audio`
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
- `setPadsRgb(request)`
- `setPadPalette(request)`
- `clearLaunchpad()`
- `onMessage(callback)`
- `onConnection(callback)`

Main process 事件：

- `midi:message`
- `midi:connection`

### 设置 API

Preload 暴露为 `window.settings`：

- `loadPlayfieldEffects()` / `savePlayfieldEffects(settings)`
- `loadMidiInput()` / `saveMidiInput(settings)`

Main process channel：

- `settings:load-playfield-effects`
- `settings:save-playfield-effects`
- `settings:load-midi-input`
- `settings:save-midi-input`

设置文件存储在 Electron `userData/app-settings.json`，不再依赖 renderer `localStorage`，避免开发服务器端口变化导致设置丢失。

## Launchpad X 约定

当前实现使用 Launchpad X Programmer Mode。

RGB 传输约定：

- Renderer / 调用侧颜色一律使用 0–255。
- Main 侧 `setPadRgb` / `setPadsRgb` 统一把 0–255 映射为 Launchpad X RGB 的 0–127。
- `setPadsRgb` 使用 Launchpad X LED Lighting 批量 colourspec，一条 SysEx 最多 81 个灯，超过才分片。
- 热路径动画当前保持约 30Hz；若实机出现灯光延迟或丢帧，再降回 20Hz。

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

输入触发规则：

- 只有 velocity ≥ 配置阈值的 Note On 才算一次触发。
- 同一个 Pad 在配置的防抖时间内重复触发会被忽略；不同 Pad 不受防抖限制。
- 防抖在 `useGameEngine.pressPad()` 内统一处理，因此实体 Launchpad 和界面 Pad 行为一致。
- Autoplay 不走 `pressPad()`，不会被防抖影响。
- 游戏中 `waiting-for-input` 和 `playing-clip` 两个阶段都接受输入；`prompting` 阶段也会在 Reveal 事件或默认提前输入窗口后接受输入。快速按下一个正确 Pad 会截断当前 clip。

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

### 阶段三：音频引擎与 Clip 试听 — 已完成

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

### 阶段四：手写谱面可玩纵切片 — 已实现，待实机验收

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

### 阶段五：波形制谱器 — 已实现，待用户实际上手验收

目标：

- 大块波形显示。
- Round / Note 两种工具。
- BPM 网格吸附和网格密度选项。
- 示例段 / 游玩段显式等长。
- Note 自动镜像到游玩段。
- Pad、颜色、数字时间编辑与试听。
- 当前编辑谱面预览：
  - 从任意时间点开始，先播放 backing track 到下一个 Round 示例段。
  - Autoplay 模式自动按正确顺序播放切片并同步灯光。
  - Real test 模式等待实体 Launchpad 或界面 Pad 输入。
  - 预览使用编辑器中的未保存 `rounds`，每次开始时快照当前谱面。

验收：

- 用户可以在无 JSON 编辑经验的情况下完成一首简单谱面。
- 每个编辑中的 Round 能被重新加载。
- 用户可以从歌曲任意时间点预览当前谱面，并分别验证自动演示和真实按键流程。
- 用户实际操作后反馈交互细节，再决定是否调整波形、吸附或列表布局。

### 阶段六：BPM Map 与节拍吸附 — 基础变速点编辑已完成

目标：

- 已完成：编辑 Tempo Map。
- 已完成：显示 BPM 变化点。
- 已完成：根据当前 BPM 生成节拍线，并在变速点后切换网格间隔。
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

- `query:` 是一个已入库的空文件；未确认前不要删除。
- `.DS_Store` 和 `.eslintcache` 出现在本机目录中，均已忽略或可忽略，不必纳入版本管理。
- Electron 端口如果被占用，electron-vite 会自动换端口，例如 5174；这不是错误。
- MIDI 断开后 CoreMIDI close 可能抛异常，当前实现已捕获，不需要恢复成崩溃。
- 音频文件通过选择器复制进 `tracks/`，原始路径不会保存为播放依赖。
- 新建 Track 的 `durationSec` 默认为 0；创建向导解码成功后会立即保存实际时长，旧项目进入制谱器后也会自动补齐。
