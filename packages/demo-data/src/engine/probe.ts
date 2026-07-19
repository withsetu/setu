/** Cross-process safety probe (#512): git-local serializes commits in-process
 *  only — a dev api running against the same sandbox is a second writer, which
 *  the GitPort contract declares unsafe (single-writer per repo; see
 *  packages/git-local/src/adapter.ts). We cannot lock another process out, so
 *  the engine detects the usual suspect (the dev api port) and WARNS honestly
 *  instead of failing or staying silent. */
import { createConnection } from 'node:net'

/** True when something accepts TCP connections on 127.0.0.1:`port`. */
export function probeLocalPort(
  port: number,
  timeoutMs = 400
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (up: boolean): void => {
      socket.destroy()
      resolve(up)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}
