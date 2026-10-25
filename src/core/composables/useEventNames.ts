import { shallowRef } from 'vue'
import { InterfaceResolver } from '../interface-resolver'

// Module-level, shared by every event list on the page
const names = shallowRef<Map<string, string>>(new Map())
let loading: Promise<void> | null = null

/**
 * Event names by topic, from every interface this browser knows, for events no interface
 * decodes. The names load again each time a page mounts event lists, so an interface saved
 * since is picked up; the lists that mount together share one load.
 */
export function useEventNames() {
  function reload(): Promise<void> {
    // Started on a later tick, so a failure always clears `loading` after it is set.
    loading = Promise.resolve()
      .then(() => InterfaceResolver.getInstance().eventNames())
      .then(
        (map) => {
          names.value = map
          loading = null
        },
        () => {
          // The names from the last load stay.
          loading = null
        }
      )
    return loading
  }
  if (!loading) void reload()
  return { names, reload }
}
