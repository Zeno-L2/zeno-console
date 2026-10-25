import { effectScope, watch } from 'vue'
import { GatewayService } from '../gateway-service'
import { useSettings } from './useSettings'

let watching = false

export function useGateway() {
  const service = GatewayService.getInstance()
  const { settings } = useSettings()

  if (!watching) {
    watching = true
    // A detached scope keeps the watch alive after the component that first
    // called useGateway() unmounts.
    effectScope(true).run(() => {
      // The service follows the saved URL.
      watch(() => settings.value.gatewayUrl, (url) => service.configure(url), { immediate: true })
    })
  }

  return { service }
}
