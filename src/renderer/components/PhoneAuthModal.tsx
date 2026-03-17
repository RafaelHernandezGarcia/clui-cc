import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Copy, Check, DeviceMobile, ArrowRight, Spinner } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'

/**
 * QR code generator — pure SVG, no dependencies.
 * Uses a simple URL-to-QR API rendered as an <img>.
 * Falls back to a copyable text field if the image fails to load.
 */
function QRCode({ url, size = 180 }: { url: string; size?: number }) {
  const colors = useColors()
  // Use Google Charts QR API (works offline-ish if cached, but mainly for display)
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=000000&margin=8`
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div
        className="flex items-center justify-center rounded-lg"
        style={{
          width: size,
          height: size / 3,
          background: colors.surfacePrimary,
          border: `1px solid ${colors.containerBorder}`,
          fontSize: 11,
          color: colors.textTertiary,
          padding: 8,
          textAlign: 'center',
        }}
      >
        QR unavailable — copy the link below
      </div>
    )
  }

  return (
    <img
      src={qrSrc}
      width={size}
      height={size}
      alt="QR code"
      style={{ borderRadius: 12, background: '#fff' }}
      onError={() => setFailed(true)}
    />
  )
}

export function PhoneAuthModal() {
  const phoneAuthOpen = useSessionStore((s) => s.phoneAuthOpen)
  const phoneAuthUrl = useSessionStore((s) => s.phoneAuthUrl)
  const phoneAuthError = useSessionStore((s) => s.phoneAuthError)
  const phoneAuthLoading = useSessionStore((s) => s.phoneAuthLoading)
  const closePhoneAuth = useSessionStore((s) => s.closePhoneAuth)
  const completePhoneAuthRedirect = useSessionStore((s) => s.completePhoneAuthRedirect)
  const colors = useColors()

  const [copied, setCopied] = useState(false)
  const [step, setStep] = useState<'scan' | 'paste'>('scan')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [redirectError, setRedirectError] = useState<string | null>(null)

  const handleCopy = useCallback(async () => {
    if (!phoneAuthUrl) return
    try {
      await navigator.clipboard.writeText(phoneAuthUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }, [phoneAuthUrl])

  const handlePasteAndComplete = useCallback(async () => {
    const url = redirectUrl.trim()
    if (!url) {
      setRedirectError('Paste the URL from your phone\'s browser address bar')
      return
    }
    if (!url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
      setRedirectError('This should be a localhost URL (the one that failed to load on your phone)')
      return
    }
    setRedirectError(null)
    await completePhoneAuthRedirect(url)
  }, [redirectUrl, completePhoneAuthRedirect])

  if (!phoneAuthOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(8px)',
        }}
        onClick={(e) => { if (e.target === e.currentTarget) closePhoneAuth() }}
      >
        <motion.div
          data-clui-ui
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ duration: 0.2 }}
          className="rounded-2xl overflow-hidden"
          style={{
            width: 400,
            maxHeight: '90vh',
            overflowY: 'auto',
            background: colors.popoverBg,
            border: `1px solid ${colors.popoverBorder}`,
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: `1px solid ${colors.popoverBorder}` }}
          >
            <div className="flex items-center gap-2">
              <DeviceMobile size={18} style={{ color: colors.accent }} />
              <span className="text-sm font-semibold" style={{ color: colors.textPrimary }}>
                Authenticate via Phone
              </span>
            </div>
            <button
              onClick={closePhoneAuth}
              className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
              style={{ color: colors.textTertiary }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 flex flex-col gap-4">
            {phoneAuthLoading && !phoneAuthUrl && (
              <div className="flex flex-col items-center gap-3 py-6">
                <Spinner size={24} className="animate-spin" style={{ color: colors.accent }} />
                <span className="text-xs" style={{ color: colors.textSecondary }}>
                  Starting claude auth login...
                </span>
              </div>
            )}

            {phoneAuthError && !phoneAuthUrl && (
              <div
                className="rounded-lg p-3 text-xs"
                style={{
                  background: colors.statusErrorBg,
                  border: `1px solid ${colors.permissionDeniedBorder}`,
                  color: colors.statusError,
                }}
              >
                {phoneAuthError}
              </div>
            )}

            {phoneAuthUrl && step === 'scan' && (
              <>
                <p className="text-xs leading-relaxed" style={{ color: colors.textSecondary }}>
                  Open this link on your phone (where you can access claude.ai).
                  After you authenticate, your phone will try to load a <code style={{ fontSize: 10, background: colors.codeBg, padding: '1px 4px', borderRadius: 3 }}>localhost</code> URL that fails. That's expected.
                </p>

                {/* QR Code */}
                <div className="flex justify-center">
                  <QRCode url={phoneAuthUrl} />
                </div>

                {/* Copyable URL */}
                <div
                  className="rounded-lg p-2.5 flex items-center gap-2 cursor-pointer select-all"
                  style={{
                    background: colors.codeBg,
                    border: `1px solid ${colors.containerBorder}`,
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: colors.textSecondary,
                    wordBreak: 'break-all',
                    lineHeight: 1.4,
                  }}
                  onClick={handleCopy}
                >
                  <span className="flex-1">{phoneAuthUrl}</span>
                  <button
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors"
                    style={{
                      background: colors.surfacePrimary,
                      color: copied ? colors.statusComplete : colors.textTertiary,
                    }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>

                {/* Next step button */}
                <button
                  onClick={() => setStep('paste')}
                  className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-medium transition-colors"
                  style={{
                    background: colors.accent,
                    color: colors.textOnAccent,
                  }}
                >
                  I authenticated on my phone <ArrowRight size={14} />
                </button>
              </>
            )}

            {phoneAuthUrl && step === 'paste' && (
              <>
                <p className="text-xs leading-relaxed" style={{ color: colors.textSecondary }}>
                  After logging in on your phone, it tried to redirect to a <code style={{ fontSize: 10, background: colors.codeBg, padding: '1px 4px', borderRadius: 3 }}>localhost</code> URL that couldn't load. Copy that full URL from your phone's address bar and paste it here:
                </p>

                <textarea
                  value={redirectUrl}
                  onChange={(e) => { setRedirectUrl(e.target.value); setRedirectError(null) }}
                  placeholder="http://localhost:XXXXX/callback?code=..."
                  className="rounded-lg p-3 text-xs resize-none"
                  style={{
                    background: colors.codeBg,
                    border: `1px solid ${redirectError ? colors.statusError : colors.containerBorder}`,
                    color: colors.textPrimary,
                    fontFamily: 'monospace',
                    minHeight: 70,
                    outline: 'none',
                  }}
                  rows={3}
                />

                {redirectError && (
                  <span className="text-xs" style={{ color: colors.statusError }}>
                    {redirectError}
                  </span>
                )}

                {phoneAuthError && (
                  <div
                    className="rounded-lg p-3 text-xs"
                    style={{
                      background: colors.statusErrorBg,
                      border: `1px solid ${colors.permissionDeniedBorder}`,
                      color: colors.statusError,
                    }}
                  >
                    {phoneAuthError}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setStep('scan')}
                    className="flex-1 rounded-xl py-2.5 text-xs font-medium transition-colors"
                    style={{
                      background: colors.surfacePrimary,
                      color: colors.textSecondary,
                      border: `1px solid ${colors.containerBorder}`,
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handlePasteAndComplete}
                    disabled={phoneAuthLoading}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-medium transition-colors"
                    style={{
                      background: phoneAuthLoading ? colors.sendDisabled : colors.accent,
                      color: colors.textOnAccent,
                    }}
                  >
                    {phoneAuthLoading ? (
                      <Spinner size={14} className="animate-spin" />
                    ) : (
                      'Complete Authentication'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
