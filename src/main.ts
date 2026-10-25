import { Buffer } from 'buffer'
import __global_polyfill from 'vite-plugin-node-polyfills/shims/global'
import __process_polyfill from 'vite-plugin-node-polyfills/shims/process'
import { createApp } from 'vue'
import { useToast } from 'nom-ui'
import App from './App.vue'
import { router } from './router'
import './style.css'

// Make Buffer, global and process available for the SDK
globalThis.Buffer = Buffer
globalThis.global = globalThis.global || __global_polyfill
globalThis.process = globalThis.process || __process_polyfill

const app = createApp(App)

// Global error handler: surface otherwise-silent errors from render,
// lifecycle hooks, and watchers to the user (and the console).
const { show } = useToast()
app.config.errorHandler = (err, _instance, info) => {
  console.error('Unhandled Vue error:', err, info)
  show('Something went wrong. Please try again.', 'error')
}

app.use(router)
app.mount('#app')
