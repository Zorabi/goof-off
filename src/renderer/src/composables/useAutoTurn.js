import { ref, onUnmounted } from 'vue'

export function useAutoTurn({ intervalSec, onTick }) {
  const running = ref(false)
  const paused = ref(false)
  const countdown = ref(0)
  let countdownTimer = null
  let pauseDepth = 0
  let wasRunningBeforePause = false

  function clearTimer() {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  function start() {
    pauseDepth = 0
    paused.value = false
    wasRunningBeforePause = false
    if (running.value) return
    running.value = true
    countdown.value = intervalSec.value
    countdownTimer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0) {
        const cont = onTick()
        if (cont === false) {
          stop()
          return
        }
        countdown.value = intervalSec.value
      }
    }, 1000)
  }

  function stop() {
    pauseDepth = 0
    paused.value = false
    wasRunningBeforePause = false
    running.value = false
    countdown.value = 0
    clearTimer()
  }

  function pause() {
    if (!running.value && !paused.value) return
    if (pauseDepth === 0) {
      wasRunningBeforePause = running.value
      if (running.value) {
        paused.value = true
        running.value = false
        countdown.value = 0
        clearTimer()
      }
    }
    pauseDepth++
  }

  function resume() {
    if (pauseDepth <= 0) return
    pauseDepth--
    if (pauseDepth > 0) return
    const shouldRestart = wasRunningBeforePause
    paused.value = false
    wasRunningBeforePause = false
    if (shouldRestart) start()
  }

  function toggle() {
    running.value || paused.value ? stop() : start()
  }

  onUnmounted(stop)

  return { running, paused, countdown, start, stop, toggle, pause, resume }
}
