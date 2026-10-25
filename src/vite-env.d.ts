/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare module 'vite-plugin-node-polyfills/shims/global' {
  const shim: typeof globalThis
  export default shim
}

declare module 'vite-plugin-node-polyfills/shims/process' {
  const shim: typeof process
  export default shim
}
