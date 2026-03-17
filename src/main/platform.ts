/**
 * Platform-specific utilities for cross-platform support (macOS, Windows).
 */

import { join } from 'path'
import { homedir, platform } from 'os'

export const isMac = platform() === 'darwin'
export const isWin = platform() === 'win32'

/**
 * Get the icon path for the main window (platform-specific extension).
 */
export function getWindowIconPath(baseDir: string): string {
  return isWin
    ? join(baseDir, 'resources', 'icon.png')
    : join(baseDir, 'resources', 'icon.icns')
}

/**
 * Get the tray icon path.
 */
export function getTrayIconPath(baseDir: string): string {
  return join(baseDir, 'resources', 'trayTemplate.png')
}

/**
 * Encode a project path for Claude's session directory structure.
 * Claude uses: ~/.claude/projects/<encoded-path>/
 * On Unix: replace / with -
 * On Windows: normalize backslashes to forward slashes, then replace / with -
 */
export function encodeProjectPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.replace(/\//g, '-')
}
