<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import PreferencesSession from './PreferencesSession.vue'
import { scheduleAfterNextPaint } from '../../src/scheduleAfterNextPaint.js'

const sessionEpoch = ref(0)
const sessionRef = ref(null)
let lastCompletedGeneration = 0
let pendingGeneration = null
let unlisten = null
let unlistenPrepareReveal = null
let cancelPreparedReveal = null
let pendingRevealGeneration = null
let disposed = false

function acknowledge(generation) {
  try {
    window.api.preferencesDeactivated(generation)
    return true
  } catch {
    return false
  }
}

async function deactivate(generation) {
  if (disposed) return
  if (!Number.isSafeInteger(generation) || generation <= 0) return
  if (generation < lastCompletedGeneration) return
  if (generation === lastCompletedGeneration) {
    acknowledge(generation)
    return
  }
  if (pendingGeneration !== null) return

  pendingGeneration = generation
  cancelPreparedReveal?.()
  cancelPreparedReveal = null
  pendingRevealGeneration = null
  sessionEpoch.value += 1
  await nextTick()

  if (disposed || pendingGeneration !== generation) return

  const sessionRoot = sessionRef.value?.$el
  const activeElement = document.activeElement
  if (activeElement && activeElement !== document.body && !sessionRoot?.contains(activeElement)) {
    activeElement.blur?.()
  }

  lastCompletedGeneration = generation
  pendingGeneration = null
  acknowledge(generation)
}

function prepareReveal(generation) {
  if (disposed) return
  if (!Number.isSafeInteger(generation) || generation <= 0) return
  cancelPreparedReveal?.()
  pendingRevealGeneration = generation
  cancelPreparedReveal = scheduleAfterNextPaint(() => {
    cancelPreparedReveal = null
    if (disposed || pendingRevealGeneration !== generation) return
    pendingRevealGeneration = null
    window.api.preferencesRevealReady(generation)
  })
}

onMounted(() => {
  disposed = false
  unlisten = window.api.onPreferencesDeactivate(deactivate) || null
  unlistenPrepareReveal = window.api.onPreferencesPrepareReveal(prepareReveal) || null
})

onBeforeUnmount(() => {
  disposed = true
  pendingGeneration = null
  pendingRevealGeneration = null
  cancelPreparedReveal?.()
  cancelPreparedReveal = null
  unlisten?.()
  unlisten = null
  unlistenPrepareReveal?.()
  unlistenPrepareReveal = null
})
</script>

<template>
  <PreferencesSession :key="sessionEpoch" ref="sessionRef" />
</template>
