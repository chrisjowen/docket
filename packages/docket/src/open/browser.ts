import { spawn } from 'node:child_process'

/** The platform's own "open this URL" command. */
const opener = (url: string): [string, string[]] => {
  switch (process.platform) {
    case 'darwin':
      return ['open', [url]]
    case 'win32':
      return ['cmd', ['/c', 'start', '""', url]]
    default:
      return ['xdg-open', [url]]
  }
}

/**
 * Best effort: a machine with no browser - CI, SSH, a container - still has
 * the printed address, so failing to launch one is not an error.
 */
export const openBrowser = (url: string): void => {
  const [command, args] = opener(url)
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => undefined)
    child.unref()
  } catch {
    // The address is printed; that is enough.
  }
}
