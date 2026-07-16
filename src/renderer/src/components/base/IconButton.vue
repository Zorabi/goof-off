<script setup>
import { computed } from 'vue'
import Icon from '../icons/Icon.vue'

const props = defineProps({
  icon: { type: String, required: true },
  ariaLabel: { type: String, required: true },
  title: { type: String, default: '' },
  active: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  disabledReason: { type: String, default: '' },
  danger: { type: Boolean, default: false },
  mini: { type: Boolean, default: false },
  iconSize: { type: String, default: '' }
})

const emit = defineEmits(['click'])

const buttonTitle = computed(() => {
  if (props.disabled && props.disabledReason) return props.disabledReason
  return props.title || undefined
})

const resolvedIconSize = computed(() => {
  if (props.iconSize) return props.iconSize
  return props.mini ? 'var(--icon-size-mini)' : 'var(--icon-size)'
})

function onClick(event) {
  emit('click', event)
}
</script>

<template>
  <button
    type="button"
    class="icon-button"
    :class="{ 'is-active': active, 'is-danger': danger, 'is-mini': mini }"
    :aria-label="ariaLabel"
    :title="buttonTitle"
    :disabled="disabled"
    @click="onClick"
  >
    <span class="icon-button-visual">
      <Icon :name="icon" :size="resolvedIconSize" />
    </span>
  </button>
</template>

<style scoped>
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  height: var(--hit-min);
  box-sizing: border-box;
  padding: calc((var(--hit-min) - 20px) / 2);
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  line-height: 1;
  transition: color var(--motion-micro) ease;
}

.icon-button-visual {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border-radius: var(--radius-button);
  background: transparent;
  transition:
    background var(--motion-micro) ease,
    transform var(--motion-micro) ease;
}

.icon-button.is-mini {
  padding: calc((var(--hit-min) - 19px) / 2);
}

.icon-button.is-mini .icon-button-visual {
  width: 19px;
  height: 19px;
  flex-basis: 19px;
}

.icon-button:not(:disabled):hover {
  color: var(--color-text-primary);
}

.icon-button.is-active {
  color: var(--color-active-icon);
}

.icon-button:not(:disabled):hover .icon-button-visual {
  background: var(--color-hover-bg);
}

.icon-button.is-active .icon-button-visual {
  background: var(--color-active-icon-bg);
}
.icon-button:not(:disabled):active .icon-button-visual {
  transform: scale(0.94);
}

.icon-button.is-danger:not(:disabled):hover {
  color: var(--color-danger);
}

.icon-button:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}

.icon-button:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .icon-button,
  .icon-button-visual {
    transition: none;
  }
}
</style>
