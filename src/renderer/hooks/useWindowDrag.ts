import { useRef, useCallback, useEffect } from 'react'

const DRAG_THRESHOLD = 4

/**
 * Returns an onMouseDown handler for custom window dragging via IPC.
 * Use on any element that should be draggable (e.g. title bar, card header).
 * Exclude interactive elements (buttons, inputs) with stopPropagation.
 */
export function useWindowDrag() {
  const lastPosRef = useRef({ x: 0, y: 0 })
  const dragStartedRef = useRef(false)
  const isDraggingRef = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    lastPosRef.current = { x: e.screenX, y: e.screenY }
    dragStartedRef.current = true
    isDraggingRef.current = false
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
      }
      lastPosRef.current = { x: e.screenX, y: e.screenY }
      window.clui.dragWindow(dx, dy)
    }
    const onUp = () => {
      dragStartedRef.current = false
      isDraggingRef.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return onMouseDown
}
