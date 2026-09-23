/**
 * 全局唯一的渲染时钟。
 *
 * 之前外圈流动和内圈射线各跑一个 setInterval(33ms)，相位互不相关，
 * 且和显示器刷新率不同步，导致灯光和动画抖动最多一整个周期（33ms）。
 *
 * 这里收敛成一条 requestAnimationFrame 循环：
 * - 所有订阅者共享同一帧、同一 dt
 * - 频率跟随显示器刷新率（ProMotion 上就是 120Hz）
 * - dt 上限 64ms，避免窗口从后台切回时动画瞬间跳过
 */

type TickFn = (nowMs: number, dtMs: number) => void

const callbacks = new Set<TickFn>()

/** 实时统计，供 UI 显示和诊断读取。 */
export const tickerStats = { fps: 0, subscribers: 0, frameMs: 0 }

let rafId = 0
let lastNow = 0
let frameCount = 0
let fpsWindowStart = 0

function loop(now: number): void {
  const dt = lastNow === 0 ? 16.7 : Math.min(64, now - lastNow)
  lastNow = now
  frameCount += 1

  if (fpsWindowStart === 0) fpsWindowStart = now
  const windowMs = now - fpsWindowStart
  if (windowMs >= 500) {
    tickerStats.fps = (frameCount * 1000) / windowMs
    tickerStats.frameMs = windowMs / frameCount
    frameCount = 0
    fpsWindowStart = now
  }

  const startedAt = performance.now()
  for (const fn of callbacks) {
    try {
      fn(now, dt)
    } catch (cause) {
      console.error('[ticker] tick failed', cause)
    }
  }
  // 平滑，避免读数跳动
  const cost = performance.now() - startedAt
  tickerStats.frameMs = tickerStats.frameMs * 0.9 + cost * 0.1

  rafId = requestAnimationFrame(loop)
}

/** 订阅每帧回调；返回取消订阅函数。 */
export function onTick(fn: TickFn): () => void {
  callbacks.add(fn)
  tickerStats.subscribers = callbacks.size
  if (rafId === 0) {
    lastNow = 0
    rafId = requestAnimationFrame(loop)
  }
  return () => {
    callbacks.delete(fn)
    tickerStats.subscribers = callbacks.size
    if (callbacks.size === 0 && rafId !== 0) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }
}
