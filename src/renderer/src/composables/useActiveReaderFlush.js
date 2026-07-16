import { shallowRef } from 'vue'

export const activeReaderFlush = shallowRef(null)

export function registerActiveReaderFlush(handler) {
  activeReaderFlush.value = handler
  return () => {
    if (activeReaderFlush.value === handler) activeReaderFlush.value = null
  }
}
