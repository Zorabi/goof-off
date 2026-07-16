import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { registerGlobalDiagnosticHandlers } from './composables/useDiagnosticLog.js'
import {
  installStealthAutoHideSpikeHarness,
  resetStealthFileBodyOpacity
} from './dev/stealthAutoHideSpikeHarness.js'

registerGlobalDiagnosticHandlers()

const stealthSpikeEnabled = import.meta.env.GOOF_OFF_STEALTH_SPIKE === '1'

if (stealthSpikeEnabled) {
  window.api?.onStealthBodyVisibilityRestore?.(() => resetStealthFileBodyOpacity())
}

installStealthAutoHideSpikeHarness({
  enabled: stealthSpikeEnabled
})

createApp(App).mount('#app')
