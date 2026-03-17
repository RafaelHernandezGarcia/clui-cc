import { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut, Tray, Menu, nativeImage, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, statSync, createReadStream } from 'fs'
import { createInterface } from 'readline'
import { homedir } from 'os'
import { isMac, isWin, getWindowIconPath, getTrayIconPath, encodeProjectPath } from './platform'
import { ControlPlane } from './claude/control-plane'
import { ensureSkills, type SkillStatus } from './skills/installer'
import { fetchCatalog, listInstalled, installPlugin, uninstallPlugin } from './marketplace/catalog'
import { log as _log, LOG_FILE, flushLogs } from './logger'
import { IPC } from '../shared/types'
import type { RunOptions, NormalizedEvent, EnrichedError } from '../shared/types'

const DEBUG_MODE = process.env.CLUI_DEBUG === '1'
const SPACES_DEBUG = DEBUG_MODE || process.env.CLUI_SPACES_DEBUG === '1'

function log(msg: string): void {
  _log('main', msg)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let screenshotCounter = 0
let toggleSequence = 0
let savedBoundsBeforeMaximize: { x: number; y: number; width: number; height: number } | null = null

// Feature flag: enable PTY interactive permissions transport
const INTERACTIVE_PTY = process.env.CLUI_INTERACTIVE_PERMISSIONS_PTY === '1'

const controlPlane = new ControlPlane(INTERACTIVE_PTY)

// Keep native width fixed to avoid renderer animation vs setBounds race.
// The UI itself still launches in compact mode; extra width is transparent/click-through.
const BAR_WIDTH = 1040
const PILL_HEIGHT = 720  // Fixed native window height — extra room for expanded UI + shadow buffers
const PILL_BOTTOM_MARGIN = 24

// ─── Broadcast to renderer ───

function broadcast(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function snapshotWindowState(reason: string): void {
  if (!SPACES_DEBUG) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    log(`[spaces] ${reason} window=none`)
    return
  }

  const b = mainWindow.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const visibleOnAll = mainWindow.isVisibleOnAllWorkspaces()
  const wcFocused = mainWindow.webContents.isFocused()

  log(
    `[spaces] ${reason} ` +
    `vis=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} wcFocused=${wcFocused} ` +
    `alwaysOnTop=${mainWindow.isAlwaysOnTop()} allWs=${visibleOnAll} ` +
    `bounds=(${b.x},${b.y},${b.width}x${b.height}) ` +
    `cursor=(${cursor.x},${cursor.y}) display=${display.id} ` +
    `workArea=(${display.workArea.x},${display.workArea.y},${display.workArea.width}x${display.workArea.height})`
  )
}

function scheduleToggleSnapshots(toggleId: number, phase: 'show' | 'hide'): void {
  if (!SPACES_DEBUG) return
  const probes = [0, 100, 400, 1200]
  for (const delay of probes) {
    setTimeout(() => {
      snapshotWindowState(`toggle#${toggleId} ${phase} +${delay}ms`)
    }, delay)
  }
}


// ─── Wire ControlPlane events → renderer ───

controlPlane.on('event', (tabId: string, event: NormalizedEvent) => {
  broadcast('clui:normalized-event', tabId, event)
})

controlPlane.on('tab-status-change', (tabId: string, newStatus: string, oldStatus: string) => {
  broadcast('clui:tab-status-change', tabId, newStatus, oldStatus)
})

controlPlane.on('error', (tabId: string, error: EnrichedError) => {
  broadcast('clui:enriched-error', tabId, error)
})

// ─── Window Creation ───

function createWindow(): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { width: screenWidth, height: screenHeight } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea

  const x = dx + Math.round((screenWidth - BAR_WIDTH) / 2)
  const y = dy + screenHeight - PILL_HEIGHT - PILL_BOTTOM_MARGIN

  mainWindow = new BrowserWindow({
    width: BAR_WIDTH,
    height: PILL_HEIGHT,
    x,
    y,
    ...(isMac ? { type: 'panel' as const } : {}),  // NSPanel — macOS only
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: !isWin,  // Show on Windows taskbar; hide on macOS (floating overlay)
    hasShadow: false,
    roundedCorners: true,
    backgroundColor: '#00000000',
    show: false,
    icon: getWindowIconPath(join(__dirname, '../..')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Belt-and-suspenders: panel already joins all spaces and floats,
  // but explicit flags ensure correct behavior on older Electron builds.
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  mainWindow.setAlwaysOnTop(true, 'screen-saver')

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    // When window is visible, receive all mouse events (needed for drag, buttons on Windows).
    // Click-through is disabled while visible — hide with Alt+Space to click through.
    mainWindow?.setIgnoreMouseEvents(false)
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  let forceQuit = false
  app.on('before-quit', () => { forceQuit = true })
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()
      mainWindow?.setIgnoreMouseEvents(true, { forward: true })
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function toggleWindow(source = 'unknown'): void {
  if (!mainWindow) return
  const toggleId = ++toggleSequence
  if (SPACES_DEBUG) {
    log(`[spaces] toggle#${toggleId} source=${source} start`)
    snapshotWindowState(`toggle#${toggleId} pre`)
  }

  // Pure toggle: visible → hide, not visible → show. No focus-based branching.
  if (mainWindow.isVisible()) {
    mainWindow.hide()
    mainWindow.setIgnoreMouseEvents(true, { forward: true })  // Click-through when hidden
    if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'hide')
  } else {
    // Position on the display where the cursor currently is (not always primary)
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const { width: sw, height: sh } = display.workAreaSize
    const { x: dx, y: dy } = display.workArea
    mainWindow.setBounds({
      x: dx + Math.round((sw - BAR_WIDTH) / 2),
      y: dy + sh - PILL_HEIGHT - PILL_BOTTOM_MARGIN,
      width: BAR_WIDTH,
      height: PILL_HEIGHT,
    })
    if (SPACES_DEBUG) {
      log(`[spaces] toggle#${toggleId} move-to-display id=${display.id}`)
      snapshotWindowState(`toggle#${toggleId} pre-show`)
    }
    // As an accessory app (app.dock.hide), show() + focus gives keyboard
    // without deactivating the active app — hover preserved everywhere.
    mainWindow.show()
    mainWindow.webContents.focus()
    mainWindow.setIgnoreMouseEvents(false)  // Receive events when visible (drag, buttons)
    broadcast(IPC.WINDOW_SHOWN)
    if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'show')
  }
}

// ─── Resize ───
// Fixed-height mode: ignore renderer resize events to prevent jank.
// The native window stays at PILL_HEIGHT; all expand/collapse happens inside the renderer.

ipcMain.on(IPC.RESIZE_HEIGHT, () => {
  // No-op — fixed height window, no dynamic resize
})

ipcMain.on(IPC.SET_WINDOW_WIDTH, () => {
  // No-op — native width is fixed to keep expand/collapse animation smooth.
})

ipcMain.handle(IPC.ANIMATE_HEIGHT, () => {
  // No-op — kept for API compat, animation handled purely in renderer
})

ipcMain.on(IPC.HIDE_WINDOW, () => {
  mainWindow?.hide()
})

ipcMain.on(IPC.WINDOW_MINIMIZE, () => {
  mainWindow?.minimize()
})

ipcMain.on(IPC.WINDOW_MAXIMIZE, () => {
  if (!mainWindow) return
  // Track state ourselves — isMaximized() returns false for transparent windows on Windows
  if (savedBoundsBeforeMaximize) {
    // Restore from maximized/fullscreen
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)
    mainWindow.setResizable(true)
    mainWindow.setBounds(savedBoundsBeforeMaximize)
    mainWindow.setResizable(false)
    savedBoundsBeforeMaximize = null
    return
  }
  savedBoundsBeforeMaximize = mainWindow.getBounds()
  mainWindow.maximize()
  // Transparent windows on Windows often don't resize; fallback to fullscreen after a tick
  setTimeout(() => {
    if (!mainWindow?.isDestroyed() && savedBoundsBeforeMaximize) {
      const b = mainWindow.getBounds()
      const display = screen.getDisplayMatching(b)
      const { width, height } = display.bounds
      if (b.width < width - 50 || b.height < height - 50) {
        mainWindow.setFullScreen(true)
      }
    }
  }, 50)
})

ipcMain.on(IPC.WINDOW_DRAG, (_event, delta: { x: number; y: number }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [x, y] = mainWindow.getPosition()
  mainWindow.setPosition(x + delta.x, y + delta.y)
})

ipcMain.handle(IPC.IS_VISIBLE, () => {
  return mainWindow?.isVisible() ?? false
})

// OS-level click-through toggle — renderer calls this on mousemove
// to enable clicks on interactive UI while passing through transparent areas
ipcMain.on(IPC.SET_IGNORE_MOUSE_EVENTS, (event, ignore: boolean, options?: { forward?: boolean }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, options || {})
  }
})

// ─── IPC Handlers (typed, strict) ───

ipcMain.handle(IPC.START, async () => {
  log('IPC START — fetching static CLI info')
  const { execSync } = require('child_process')
  const execOpts = { encoding: 'utf-8' as const, timeout: 5000, ...(isWin ? { shell: true } : {}) }

  let version = 'unknown'
  try {
    version = execSync('claude -v', execOpts).trim()
  } catch {}

  let auth: { email?: string; subscriptionType?: string; authMethod?: string } = {}
  try {
    const raw = execSync('claude auth status', execOpts).trim()
    auth = JSON.parse(raw)
  } catch {}

  let mcpServers: string[] = []
  try {
    const raw = execSync('claude mcp list', execOpts).trim()
    if (raw) mcpServers = raw.split(/\r?\n/).filter(Boolean)
  } catch {}

  return { version, auth, mcpServers, projectPath: process.cwd(), homePath: require('os').homedir() }
})

ipcMain.handle(IPC.CREATE_TAB, () => {
  const tabId = controlPlane.createTab()
  log(`IPC CREATE_TAB → ${tabId}`)
  return { tabId }
})

ipcMain.on(IPC.INIT_SESSION, (_event, tabId: string) => {
  log(`IPC INIT_SESSION: ${tabId}`)
  controlPlane.initSession(tabId)
})

ipcMain.on(IPC.RESET_TAB_SESSION, (_event, tabId: string) => {
  log(`IPC RESET_TAB_SESSION: ${tabId}`)
  controlPlane.resetTabSession(tabId)
})

ipcMain.handle(IPC.PROMPT, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  if (DEBUG_MODE) {
    log(`IPC PROMPT: tab=${tabId} req=${requestId} prompt="${options.prompt.substring(0, 100)}"`)
  } else {
    log(`IPC PROMPT: tab=${tabId} req=${requestId}`)
  }

  if (!tabId) {
    throw new Error('No tabId provided — prompt rejected')
  }
  if (!requestId) {
    throw new Error('No requestId provided — prompt rejected')
  }

  try {
    await controlPlane.submitPrompt(tabId, requestId, options)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`PROMPT error: ${msg}`)
    throw err
  }
})

ipcMain.handle(IPC.CANCEL, (_event, requestId: string) => {
  log(`IPC CANCEL: ${requestId}`)
  return controlPlane.cancel(requestId)
})

ipcMain.handle(IPC.STOP_TAB, (_event, tabId: string) => {
  log(`IPC STOP_TAB: ${tabId}`)
  return controlPlane.cancelTab(tabId)
})

ipcMain.handle(IPC.RETRY, async (_event, { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }) => {
  log(`IPC RETRY: tab=${tabId} req=${requestId}`)
  return controlPlane.retry(tabId, requestId, options)
})

ipcMain.handle(IPC.STATUS, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.TAB_HEALTH, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.CLOSE_TAB, (_event, tabId: string) => {
  log(`IPC CLOSE_TAB: ${tabId}`)
  controlPlane.closeTab(tabId)
})

ipcMain.on(IPC.SET_PERMISSION_MODE, (_event, mode: string) => {
  if (mode !== 'ask' && mode !== 'auto') {
    log(`IPC SET_PERMISSION_MODE: invalid mode "${mode}" — ignoring`)
    return
  }
  log(`IPC SET_PERMISSION_MODE: ${mode}`)
  controlPlane.setPermissionMode(mode)
})

ipcMain.handle(IPC.RESPOND_PERMISSION, (_event, { tabId, questionId, optionId }: { tabId: string; questionId: string; optionId: string }) => {
  log(`IPC RESPOND_PERMISSION: tab=${tabId} question=${questionId} option=${optionId}`)
  return controlPlane.respondToPermission(tabId, questionId, optionId)
})

ipcMain.handle(IPC.LIST_SESSIONS, async (_e, projectPath?: string) => {
  log(`IPC LIST_SESSIONS ${projectPath ? `(path=${projectPath})` : ''}`)
  try {
    const cwd = projectPath || process.cwd()
    // Claude stores project sessions at ~/.claude/projects/<encoded-path>/
    // Path encoding: normalize and replace / with -
    const encodedPath = encodeProjectPath(cwd)
    const sessionsDir = join(homedir(), '.claude', 'projects', encodedPath)
    if (!existsSync(sessionsDir)) {
      log(`LIST_SESSIONS: directory not found: ${sessionsDir}`)
      return []
    }
    const files = readdirSync(sessionsDir).filter((f: string) => f.endsWith('.jsonl'))

    const sessions: Array<{ sessionId: string; slug: string | null; firstMessage: string | null; lastTimestamp: string; size: number }> = []

    // UUID v4 regex — only consider files named as valid UUIDs
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    for (const file of files) {
      // The filename (without .jsonl) IS the canonical resume ID for `claude --resume`
      const fileSessionId = file.replace(/\.jsonl$/, '')
      if (!UUID_RE.test(fileSessionId)) continue // skip non-UUID files

      const filePath = join(sessionsDir, file)
      const stat = statSync(filePath)
      if (stat.size < 100) continue // skip trivially small files

      // Read lines to extract metadata and validate transcript schema
      const meta: { validated: boolean; slug: string | null; firstMessage: string | null; lastTimestamp: string | null } = {
        validated: false, slug: null, firstMessage: null, lastTimestamp: null,
      }

      await new Promise<void>((resolve) => {
        const rl = createInterface({ input: createReadStream(filePath) })
        rl.on('line', (line: string) => {
          try {
            const obj = JSON.parse(line)
            // Validate: must have expected Claude transcript fields
            if (!meta.validated && obj.type && obj.uuid && obj.timestamp) {
              meta.validated = true
            }
            if (obj.slug && !meta.slug) meta.slug = obj.slug
            if (obj.timestamp) meta.lastTimestamp = obj.timestamp
            if (obj.type === 'user' && !meta.firstMessage) {
              const content = obj.message?.content
              if (typeof content === 'string') {
                meta.firstMessage = content.substring(0, 100)
              } else if (Array.isArray(content)) {
                const textPart = content.find((p: any) => p.type === 'text')
                meta.firstMessage = textPart?.text?.substring(0, 100) || null
              }
            }
          } catch {}
          // Read all lines to get the last timestamp
        })
        rl.on('close', () => resolve())
      })

      if (meta.validated) {
        sessions.push({
          sessionId: fileSessionId,
          slug: meta.slug,
          firstMessage: meta.firstMessage,
          lastTimestamp: meta.lastTimestamp || stat.mtime.toISOString(),
          size: stat.size,
        })
      }
    }

    // Sort by last timestamp, most recent first
    sessions.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
    return sessions.slice(0, 20) // Return top 20
  } catch (err) {
    log(`LIST_SESSIONS error: ${err}`)
    return []
  }
})

// Load conversation history from a session's JSONL file
ipcMain.handle(IPC.LOAD_SESSION, async (_e, arg: { sessionId: string; projectPath?: string } | string) => {
  const sessionId = typeof arg === 'string' ? arg : arg.sessionId
  const projectPath = typeof arg === 'string' ? undefined : arg.projectPath
  log(`IPC LOAD_SESSION ${sessionId}${projectPath ? ` (path=${projectPath})` : ''}`)
  try {
    const cwd = projectPath || process.cwd()
    const encodedPath = encodeProjectPath(cwd)
    const filePath = join(homedir(), '.claude', 'projects', encodedPath, `${sessionId}.jsonl`)
    if (!existsSync(filePath)) return []

    const messages: Array<{ role: string; content: string; toolName?: string; timestamp: number }> = []
    await new Promise<void>((resolve) => {
      const rl = createInterface({ input: createReadStream(filePath) })
      rl.on('line', (line: string) => {
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'user') {
            const content = obj.message?.content
            let text = ''
            if (typeof content === 'string') {
              text = content
            } else if (Array.isArray(content)) {
              text = content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n')
            }
            if (text) {
              messages.push({ role: 'user', content: text, timestamp: new Date(obj.timestamp).getTime() })
            }
          } else if (obj.type === 'assistant') {
            const content = obj.message?.content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  messages.push({ role: 'assistant', content: block.text, timestamp: new Date(obj.timestamp).getTime() })
                } else if (block.type === 'tool_use' && block.name) {
                  messages.push({
                    role: 'tool',
                    content: '',
                    toolName: block.name,
                    timestamp: new Date(obj.timestamp).getTime(),
                  })
                }
              }
            }
          }
        } catch {}
      })
      rl.on('close', () => resolve())
    })
    return messages
  } catch (err) {
    log(`LOAD_SESSION error: ${err}`)
    return []
  }
})

ipcMain.handle(IPC.SELECT_DIRECTORY, async () => {
  if (!mainWindow) return null
  // macOS: activate app so unparented dialog appears on top (not behind other apps).
  // Windows: use mainWindow as parent so dialog appears correctly.
  if (isMac) app.focus()
  const options = { properties: ['openDirectory'] as const }
  const result = isMac
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow!, options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
  try {
    // Only allow http(s) links from markdown content.
    if (!/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
})

ipcMain.handle(IPC.ATTACH_FILES, async () => {
  if (!mainWindow) return null
  // macOS: activate app so unparented dialog appears on top
  if (isMac) app.focus()
  const options = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      { name: 'Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'md', 'json', 'yaml', 'toml'] },
    ],
  }
  const result = isMac
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(mainWindow, options)
  if (result.canceled || result.filePaths.length === 0) return null

  const { basename, extname } = require('path')
  const { readFileSync, statSync } = require('fs')

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    '.json': 'application/json', '.yaml': 'text/yaml', '.toml': 'text/toml',
  }

  return result.filePaths.map((fp: string) => {
    const ext = extname(fp).toLowerCase()
    const mime = mimeMap[ext] || 'application/octet-stream'
    const stat = statSync(fp)
    let dataUrl: string | undefined

    // Generate preview data URL for images (max 2MB to keep IPC fast)
    if (IMAGE_EXTS.has(ext) && stat.size < 2 * 1024 * 1024) {
      try {
        const buf = readFileSync(fp)
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      } catch {}
    }

    return {
      id: crypto.randomUUID(),
      type: IMAGE_EXTS.has(ext) ? 'image' : 'file',
      name: basename(fp),
      path: fp,
      mimeType: mime,
      dataUrl,
      size: stat.size,
    }
  })
})

ipcMain.handle(IPC.TAKE_SCREENSHOT, async () => {
  if (!mainWindow) return null

  if (SPACES_DEBUG) snapshotWindowState('screenshot pre-hide')
  mainWindow.hide()
  await new Promise((r) => setTimeout(r, 300))

  try {
    const { execSync } = require('child_process')
    const { join } = require('path')
    const { tmpdir } = require('os')
    const { readFileSync, existsSync } = require('fs')

    const timestamp = Date.now()
    const screenshotPath = join(tmpdir(), `clui-screenshot-${timestamp}.png`)

    if (isWin) {
      // Windows: use PowerShell + .NET to capture full screen
      const { writeFileSync } = require('fs')
      const psScriptPath = join(tmpdir(), `clui-screenshot-${timestamp}.ps1`)
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('${screenshotPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`.trim()
      writeFileSync(psScriptPath, psScript, 'utf-8')
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, {
        timeout: 30000,
        stdio: 'ignore',
      })
    } else {
      execSync(`/usr/sbin/screencapture -i "${screenshotPath}"`, {
        timeout: 30000,
        stdio: 'ignore',
      })
    }

    if (!existsSync(screenshotPath)) {
      return null
    }

    // Return structured attachment with data URL preview
    const buf = readFileSync(screenshotPath)
    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `screenshot ${++screenshotCounter}.png`,
      path: screenshotPath,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      size: buf.length,
    }
  } catch {
    return null
  } finally {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.webContents.focus()
      mainWindow.setIgnoreMouseEvents(false)
    }
    broadcast(IPC.WINDOW_SHOWN)
    if (SPACES_DEBUG) {
      log('[spaces] screenshot restore show+focus')
      snapshotWindowState('screenshot restore immediate')
      setTimeout(() => snapshotWindowState('screenshot restore +200ms'), 200)
    }
  }
})

let pasteCounter = 0
ipcMain.handle(IPC.PASTE_IMAGE, async (_event, dataUrl: string) => {
  try {
    const { writeFileSync } = require('fs')
    const { join } = require('path')
    const { tmpdir } = require('os')

    // Parse data URL: "data:image/png;base64,..."
    const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/)
    if (!match) return null

    const [, mimeType, ext, base64Data] = match
    const buf = Buffer.from(base64Data, 'base64')
    const timestamp = Date.now()
    const filePath = join(tmpdir(), `clui-paste-${timestamp}.${ext}`)
    writeFileSync(filePath, buf)

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `pasted image ${++pasteCounter}.${ext}`,
      path: filePath,
      mimeType,
      dataUrl,
      size: buf.length,
    }
  } catch {
    return null
  }
})

ipcMain.handle(IPC.TRANSCRIBE_AUDIO, async (_event, audioBase64: string) => {
  const { writeFileSync, existsSync, unlinkSync, readFileSync } = require('fs')
  const { execSync } = require('child_process')
  const { join } = require('path')
  const { tmpdir } = require('os')

  const tmpWav = join(tmpdir(), `clui-voice-${Date.now()}.wav`)
  try {
    const buf = Buffer.from(audioBase64, 'base64')
    writeFileSync(tmpWav, buf)

    let whisperBin = ''
    const modelCandidates: string[] = []

    if (isWin) {
      // Windows: check common install locations
      const winCandidates = [
        join(homedir(), 'scoop', 'shims', 'whisper-cli.exe'),
        join(homedir(), 'scoop', 'shims', 'whisper.exe'),
        join(homedir(), 'AppData', 'Local', 'Programs', 'whisper', 'whisper-cli.exe'),
        'whisper-cli',
        'whisper',
      ]
      for (const c of winCandidates) {
        if (c.includes('.exe') && existsSync(c)) { whisperBin = c; break }
      }
      if (!whisperBin) {
        try {
          whisperBin = execSync('where whisper-cli', { encoding: 'utf-8' }).trim().split('\n')[0]
        } catch {}
        if (!whisperBin) {
          try {
            whisperBin = execSync('where whisper', { encoding: 'utf-8' }).trim().split('\n')[0]
          } catch {}
        }
      }
      modelCandidates.push(
        join(homedir(), '.local', 'share', 'whisper', 'ggml-tiny.bin'),
        join(homedir(), '.local', 'share', 'whisper', 'ggml-base.bin'),
        join(homedir(), 'scoop', 'persist', 'whisper-cpp', 'models', 'ggml-tiny.bin'),
        join(homedir(), 'scoop', 'persist', 'whisper-cpp', 'models', 'ggml-base.bin'),
      )
    } else {
      // macOS/Linux
      const candidates = [
        '/opt/homebrew/bin/whisper-cli',
        '/usr/local/bin/whisper-cli',
        '/opt/homebrew/bin/whisper',
        '/usr/local/bin/whisper',
        join(homedir(), '.local/bin/whisper'),
      ]
      for (const c of candidates) {
        if (existsSync(c)) { whisperBin = c; break }
      }
      if (!whisperBin) {
        try {
          whisperBin = execSync('/bin/zsh -lc "whence -p whisper-cli"', { encoding: 'utf-8' }).trim()
        } catch {}
      }
      if (!whisperBin) {
        try {
          whisperBin = execSync('/bin/zsh -lc "whence -p whisper"', { encoding: 'utf-8' }).trim()
        } catch {}
      }
      modelCandidates.push(
        join(homedir(), '.local/share/whisper/ggml-tiny.bin'),
        join(homedir(), '.local/share/whisper/ggml-base.bin'),
        '/opt/homebrew/share/whisper-cpp/models/ggml-tiny.bin',
        '/opt/homebrew/share/whisper-cpp/models/ggml-base.bin',
        join(homedir(), '.local/share/whisper/ggml-tiny.en.bin'),
        join(homedir(), '.local/share/whisper/ggml-base.en.bin'),
        '/opt/homebrew/share/whisper-cpp/models/ggml-tiny.en.bin',
        '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin',
      )
    }

    if (!whisperBin) {
      return {
        error: isWin
          ? 'Whisper not found. Install with: scoop install whisper-cpp or pip install openai-whisper'
          : 'Whisper not found. Install with: brew install whisper-cpp',
        transcript: null,
      }
    }

    const isWhisperCpp = whisperBin.includes('whisper-cli')

    let modelPath = ''
    for (const m of modelCandidates) {
      if (existsSync(m)) { modelPath = m; break }
    }

    // Detect if using an English-only model (.en suffix) — force English if so
    const isEnglishOnly = modelPath.includes('.en.')
    log(`Transcribing with: ${whisperBin} (model: ${modelPath || 'default'}, lang: ${isEnglishOnly ? 'en' : 'auto'})`)

    let output: string
    if (isWhisperCpp) {
      // whisper-cpp: whisper-cli -m model -f file --no-timestamps
      if (!modelPath) {
        return {
          error: 'Whisper model not found. Download with:\nmkdir -p ~/.local/share/whisper && curl -L -o ~/.local/share/whisper/ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
          transcript: null,
        }
      }
      const langFlag = isEnglishOnly ? '-l en' : '-l auto'
      output = execSync(
        `"${whisperBin}" -m "${modelPath}" -f "${tmpWav}" --no-timestamps ${langFlag}`,
        { encoding: 'utf-8', timeout: 30000 }
      )
    } else {
      // Python whisper: auto-detect language unless English-only model
      const langFlag = isEnglishOnly ? '--language en' : ''
      output = execSync(
        `"${whisperBin}" "${tmpWav}" --model tiny ${langFlag} --output_format txt --output_dir "${tmpdir()}"`,
        { encoding: 'utf-8', timeout: 30000 }
      )
      // Python whisper writes .txt file
      const txtPath = tmpWav.replace('.wav', '.txt')
      if (existsSync(txtPath)) {
        const transcript = readFileSync(txtPath, 'utf-8').trim()
        try { unlinkSync(txtPath) } catch {}
        return { error: null, transcript }
      }
    }

    // whisper-cpp prints to stdout directly
    // Strip any leading [timestamp] patterns and whitespace
    const transcript = output
      .replace(/\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/g, '')
      .trim()

    return { error: null, transcript: transcript || '' }
  } catch (err: any) {
    log(`Transcription error: ${err.message}`)
    return {
      error: `Transcription failed: ${err.message}`,
      transcript: null,
    }
  } finally {
    try { unlinkSync(tmpWav) } catch {}
  }
})

ipcMain.handle(IPC.GET_DIAGNOSTICS, () => {
  const { readFileSync, existsSync } = require('fs')
  const health = controlPlane.getHealth()

  let recentLogs = ''
  if (existsSync(LOG_FILE)) {
    try {
      const content = readFileSync(LOG_FILE, 'utf-8')
      const lines = content.split('\n')
      recentLogs = lines.slice(-100).join('\n')
    } catch {}
  }

  return {
    health,
    logPath: LOG_FILE,
    recentLogs,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    appVersion: app.getVersion(),
    transport: INTERACTIVE_PTY ? 'pty' : 'stream-json',
  }
})

ipcMain.handle(IPC.LAUNCH_AUTH_LOGIN, () => {
  const { spawn } = require('child_process')
  try {
    if (isWin) {
      spawn('cmd', ['/c', 'start', 'cmd', '/k', 'claude auth login'], {
        detached: true,
        stdio: 'ignore',
      }).unref()
      log('Launched auth login in new terminal')
      return true
    }
    // macOS: open Terminal with claude auth login
    const script = 'tell application "Terminal" to do script "claude auth login"'
    require('child_process').execFile('/usr/bin/osascript', ['-e', script], () => {})
    return true
  } catch (err: unknown) {
    log(`Failed to launch auth login: ${err}`)
    return false
  }
})

ipcMain.handle(IPC.OPEN_IN_TERMINAL, (_event, arg: string | null | { sessionId?: string | null; projectPath?: string }) => {
  const { execFile, spawn } = require('child_process')
  const claudeBin = 'claude'

  // Support both old (string) and new ({ sessionId, projectPath }) calling convention
  let sessionId: string | null = null
  let projectPath: string = process.cwd()
  if (typeof arg === 'string') {
    sessionId = arg
  } else if (arg && typeof arg === 'object') {
    sessionId = arg.sessionId ?? null
    projectPath = arg.projectPath && arg.projectPath !== '~' ? arg.projectPath : process.cwd()
  }

  try {
    if (isWin) {
      // Windows: start cmd or PowerShell in a new window
      const resumeArg = sessionId ? ` --resume ${sessionId}` : ''
      const cmd = `cd /d "${projectPath}" && ${claudeBin}${resumeArg}`
      spawn('cmd', ['/c', 'start', 'cmd', '/k', cmd], {
        detached: true,
        stdio: 'ignore',
      }).unref()
      log(`Opened terminal with: ${cmd}`)
      return true
    }

    // macOS: AppleScript to open Terminal.app
    const projectDir = projectPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    let cmd: string
    if (sessionId) {
      cmd = `cd \\"${projectDir}\\" && ${claudeBin} --resume ${sessionId}`
    } else {
      cmd = `cd \\"${projectDir}\\" && ${claudeBin}`
    }

    const script = `tell application "Terminal"
  activate
  do script "${cmd}"
end tell`

    execFile('/usr/bin/osascript', ['-e', script], (err: Error | null) => {
      if (err) log(`Failed to open terminal: ${err.message}`)
      else log(`Opened terminal with: ${cmd}`)
    })
    return true
  } catch (err: unknown) {
    log(`Failed to open terminal: ${err}`)
    return false
  }
})

// ─── Marketplace IPC ───

ipcMain.handle(IPC.MARKETPLACE_FETCH, async (_event, { forceRefresh } = {}) => {
  log('IPC MARKETPLACE_FETCH')
  return fetchCatalog(forceRefresh)
})

ipcMain.handle(IPC.MARKETPLACE_INSTALLED, async () => {
  log('IPC MARKETPLACE_INSTALLED')
  return listInstalled()
})

ipcMain.handle(IPC.MARKETPLACE_INSTALL, async (_event, { repo, pluginName, marketplace, sourcePath, isSkillMd }: { repo: string; pluginName: string; marketplace: string; sourcePath?: string; isSkillMd?: boolean }) => {
  log(`IPC MARKETPLACE_INSTALL: ${pluginName} from ${repo} (isSkillMd=${isSkillMd})`)
  return installPlugin(repo, pluginName, marketplace, sourcePath, isSkillMd)
})

ipcMain.handle(IPC.MARKETPLACE_UNINSTALL, async (_event, { pluginName }: { pluginName: string }) => {
  log(`IPC MARKETPLACE_UNINSTALL: ${pluginName}`)
  return uninstallPlugin(pluginName)
})

// ─── Theme Detection ───

ipcMain.handle(IPC.GET_THEME, () => {
  return { isDark: nativeTheme.shouldUseDarkColors }
})

nativeTheme.on('updated', () => {
  broadcast(IPC.THEME_CHANGED, nativeTheme.shouldUseDarkColors)
})

// ─── App Lifecycle ───

app.whenReady().then(() => {
  // macOS: become an accessory app. Accessory apps can have key windows (keyboard works)
  // without deactivating the currently active app (hover preserved in browsers).
  if (isMac && app.dock) {
    app.dock.hide()
  }

  // Skill provisioning — non-blocking, streams status to renderer
  ensureSkills((status: SkillStatus) => {
    log(`Skill ${status.name}: ${status.state}${status.error ? ` — ${status.error}` : ''}`)
    broadcast(IPC.SKILL_STATUS, status)
  }).catch((err: Error) => log(`Skill provisioning error: ${err.message}`))

  createWindow()
  snapshotWindowState('after createWindow')

  if (SPACES_DEBUG) {
    mainWindow?.on('show', () => snapshotWindowState('event window show'))
    mainWindow?.on('hide', () => snapshotWindowState('event window hide'))
    mainWindow?.on('focus', () => snapshotWindowState('event window focus'))
    mainWindow?.on('blur', () => snapshotWindowState('event window blur'))
    mainWindow?.webContents.on('focus', () => snapshotWindowState('event webContents focus'))
    mainWindow?.webContents.on('blur', () => snapshotWindowState('event webContents blur'))

    app.on('browser-window-focus', () => snapshotWindowState('event app browser-window-focus'))
    app.on('browser-window-blur', () => snapshotWindowState('event app browser-window-blur'))

    screen.on('display-added', (_e, display) => {
      log(`[spaces] event display-added id=${display.id}`)
      snapshotWindowState('event display-added')
    })
    screen.on('display-removed', (_e, display) => {
      log(`[spaces] event display-removed id=${display.id}`)
      snapshotWindowState('event display-removed')
    })
    screen.on('display-metrics-changed', (_e, display, changedMetrics) => {
      log(`[spaces] event display-metrics-changed id=${display.id} changed=${changedMetrics.join(',')}`)
      snapshotWindowState('event display-metrics-changed')
    })
  }


  // Primary: Option+Space (2 keys, doesn't conflict with shell)
  // Fallback: Cmd+Shift+K kept as secondary shortcut
  const registered = globalShortcut.register('Alt+Space', () => toggleWindow('shortcut Alt+Space'))
  if (!registered) {
    log('Alt+Space shortcut registration failed — macOS input sources may claim it')
  }
  globalShortcut.register('CommandOrControl+Shift+K', () => toggleWindow('shortcut Cmd/Ctrl+Shift+K'))

  const trayIconPath = getTrayIconPath(join(__dirname, '../..'))
  const trayIcon = nativeImage.createFromPath(trayIconPath)
  if (isMac) trayIcon.setTemplateImage(true)  // Template icons for macOS dark/light mode
  tray = new Tray(trayIcon)
  tray.setToolTip('Clui CC — Claude Code UI')
  tray.on('click', () => toggleWindow('tray click'))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Clui CC', click: () => toggleWindow('tray menu Show Clui CC') },
      { label: 'Quit', click: () => { app.quit() } },
    ])
  )

  if (isMac) {
    app.on('activate', () => toggleWindow('app activate'))
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  controlPlane.shutdown()
  flushLogs()
})

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})
