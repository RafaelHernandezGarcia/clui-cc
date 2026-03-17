import React, { useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Minus, ArrowsOut, ArrowsIn, DotsSixVertical, DeviceMobile } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { HistoryPicker } from './HistoryPicker'
import { SettingsPopover } from './SettingsPopover'
import { useColors } from '../theme'
import type { TabStatus } from '../../shared/types'

function StatusDot({ status, hasUnread, hasPermission }: { status: TabStatus; hasUnread: boolean; hasPermission: boolean }) {
  const colors = useColors()
  let bg: string = colors.statusIdle
  let pulse = false
  let glow = false

  if (status === 'dead' || status === 'failed') {
    bg = colors.statusError
  } else if (hasPermission) {
    bg = colors.statusPermission
    glow = true
  } else if (status === 'connecting' || status === 'running') {
    bg = colors.statusRunning
    pulse = true
  } else if (hasUnread) {
    bg = colors.statusComplete
  }

  return (
    <span
      className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${pulse ? 'animate-pulse-dot' : ''}`}
      style={{
        background: bg,
        ...(glow ? { boxShadow: `0 0 6px 2px ${colors.statusPermissionGlow}` } : {}),
      }}
    />
  )
}

export function TabStrip() {
  const tabs = useSessionStore((s) => s.tabs)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const selectTab = useSessionStore((s) => s.selectTab)
  const createTab = useSessionStore((s) => s.createTab)
  const closeTab = useSessionStore((s) => s.closeTab)
  const isMaximized = useSessionStore((s) => s.isMaximized)
  const colors = useColors()
  const isDraggingRef = useRef(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const dragStartedRef = useRef(false)
  const draggedRef = useRef(false) // true if we actually moved the window (used to suppress tab click)
  const DRAG_THRESHOLD = 4

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    lastPosRef.current = { x: e.screenX, y: e.screenY }
    dragStartedRef.current = true
    isDraggingRef.current = false
    draggedRef.current = false
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragStartedRef.current) return
      const dx = e.screenX - lastPosRef.current.x
      const dy = e.screenY - lastPosRef.current.y
      if (!isDraggingRef.current) {
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < DRAG_THRESHOLD) return
        isDraggingRef.current = true
        draggedRef.current = true
      }
      lastPosRef.current = { x: e.screenX, y: e.screenY }
      window.clui.dragWindow(dx, dy)
    }
    const onUp = () => {
      dragStartedRef.current = false
      isDraggingRef.current = false
      setTimeout(() => { draggedRef.current = false }, 0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div
      data-clui-ui
      className="flex items-center"
      style={{ padding: '8px 0' }}
    >
      {/* Drag area — entire left side (grip + tabs) is draggable; buttons on right are not */}
      <div
        className="flex-shrink-0 w-6 flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{ color: colors.textTertiary, opacity: 0.5 }}
        title="Drag to move"
        onMouseDown={handleDragStart}
      >
        <DotsSixVertical size={12} />
      </div>
      <div
        className="relative min-w-0 flex-1 cursor-grab active:cursor-grabbing"
        style={{ minHeight: 28 }}
        onMouseDown={handleDragStart}
      >
        <div
          className="flex items-center gap-1 overflow-x-auto min-w-0"
          style={{
            scrollbarWidth: 'none',
            paddingLeft: 8,
            // Extra right breathing room so clipped tabs fade out before the edge.
            paddingRight: 14,
            // Right-only content fade so the parent card's own animated background
            // shows through cleanly in both collapsed and expanded states.
            maskImage: 'linear-gradient(to right, black 0%, black calc(100% - 40px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black calc(100% - 40px), transparent 100%)',
          }}
        >
          <AnimatePresence mode="popLayout">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId
              return (
                <motion.div
                  key={tab.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.15 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (draggedRef.current) {
                      draggedRef.current = false
                      e.preventDefault()
                      return
                    }
                    selectTab(tab.id)
                  }}
                  className="group flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0 max-w-[160px] transition-all duration-150"
                  style={{
                    background: isActive ? colors.tabActive : 'transparent',
                    border: isActive ? `1px solid ${colors.tabActiveBorder}` : '1px solid transparent',
                    borderRadius: 9999,
                    padding: '4px 10px',
                    fontSize: 12,
                    color: isActive ? colors.textPrimary : colors.textTertiary,
                    fontWeight: isActive ? 500 : 400,
                  }}
                >
                  <StatusDot status={tab.status} hasUnread={tab.hasUnread} hasPermission={tab.permissionQueue.length > 0} />
                  <span className="truncate flex-1">{tab.title}</span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                      className="flex-shrink-0 rounded-full w-4 h-4 flex items-center justify-center transition-opacity"
                      style={{
                        opacity: isActive ? 0.5 : 0,
                        color: colors.textSecondary,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = isActive ? '0.5' : '0' }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Pinned action buttons — always visible on the right */}
      <div className="flex items-center gap-0.5 flex-shrink-0 ml-1 pr-2 no-drag" onMouseDown={(e) => e.stopPropagation()}>
        <button
          onClick={() => useSessionStore.getState().openPhoneAuth()}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors hover:bg-black/10"
          style={{ color: colors.textTertiary }}
          title="Authenticate via phone"
        >
          <DeviceMobile size={14} />
        </button>
        <button
          onClick={() => window.clui.minimizeWindow()}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors hover:bg-black/10"
          style={{ color: colors.textTertiary }}
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => window.clui.maximizeWindow()}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors hover:bg-black/10"
          style={{ color: colors.textTertiary }}
          title={isMaximized ? 'Restore window' : 'Maximize'}
        >
          {isMaximized ? <ArrowsIn size={12} /> : <ArrowsOut size={12} />}
        </button>
        <button
          onClick={() => createTab()}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors hover:bg-black/10"
          style={{ color: colors.textTertiary }}
          title="New tab"
        >
          <Plus size={14} />
        </button>

        <HistoryPicker />

        <SettingsPopover />
      </div>
    </div>
  )
}
