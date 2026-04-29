'use client'
import { ReactNode, useState } from 'react'
import clsx from 'clsx'

// ── Badge ──────────────────────────────────────────────────────────────────
type BadgeVariant = 'critical' | 'warning' | 'info' | 'success' | 'muted' | 'verify'

const badgeStyles: Record<BadgeVariant, string> = {
  critical: 'bg-[rgba(248,113,113,0.12)] text-[#f87171] border border-[rgba(248,113,113,0.2)]',
  warning:  'bg-[rgba(251,191,36,0.12)]  text-[#fbbf24] border border-[rgba(251,191,36,0.2)]',
  info:     'bg-[rgba(147,197,253,0.12)] text-[#93c5fd] border border-[rgba(147,197,253,0.2)]',
  success:  'bg-[rgba(110,231,183,0.12)] text-[#6ee7b7] border border-[rgba(110,231,183,0.2)]',
  verify:   'bg-[rgba(110,231,183,0.08)] text-[#6ee7b7] border border-[rgba(110,231,183,0.15)]',
  muted:    'bg-[rgba(122,120,133,0.15)] text-[#7a7885]  border border-[rgba(122,120,133,0.2)]',
}

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return (
    <span className={clsx(
      'inline-block font-mono text-[10px] tracking-wide px-2 py-0.5 rounded',
      badgeStyles[variant]
    )}>
      {children}
    </span>
  )
}

// ── Alert level → badge variant ────────────────────────────────────────────
export function alertVariant(level: string): BadgeVariant {
  return ({ CRITICAL: 'critical', WARNING: 'warning', INFO: 'info', VERIFY: 'verify', ON_TRACK: 'success' } as any)[level] ?? 'muted'
}

export function alertBarColor(level: string) {
  return ({ CRITICAL: '#f87171', WARNING: '#fbbf24', INFO: '#93c5fd', VERIFY: '#6ee7b7', ON_TRACK: '#6ee7b7' } as any)[level] ?? '#7a7885'
}

// ── Button ─────────────────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
  children: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', loading, children, className, disabled, ...props }: ButtonProps) {
  const base = 'inline-flex items-center gap-2 font-mono rounded transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed'
  const sizes = { sm: 'text-[11px] px-3 py-1.5', md: 'text-[12px] px-4 py-2' }
  const variants = {
    primary:   'bg-[#c8f04c] text-[#0f0f11] font-semibold hover:bg-[#d4f55e] border border-[#c8f04c]',
    secondary: 'bg-transparent text-[#f0eff5] border border-[rgba(255,255,255,0.13)] hover:bg-[#1e1e22] hover:border-[rgba(255,255,255,0.2)]',
    ghost:     'bg-transparent text-[#7a7885] border border-transparent hover:text-[#f0eff5] hover:bg-[#1e1e22]',
    danger:    'bg-transparent text-[#f87171] border border-[rgba(248,113,113,0.3)] hover:bg-[rgba(248,113,113,0.1)]',
  }
  return (
    <button className={clsx(base, sizes[size], variants[variant], className)} disabled={disabled || loading} {...props}>
      {loading && <span className="spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />}
      {children}
    </button>
  )
}

// ── Card ───────────────────────────────────────────────────────────────────
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx(
      'bg-[#17171a] border border-[rgba(255,255,255,0.07)] rounded-xl',
      className
    )}>
      {children}
    </div>
  )
}

// ── Stat card ──────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: 'red' | 'yellow' | 'green' | 'white' }) {
  const colors = { red: '#f87171', yellow: '#fbbf24', green: '#6ee7b7', white: '#f0eff5' }
  return (
    <div className="bg-[#17171a] border border-[rgba(255,255,255,0.07)] rounded-xl p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-[#7a7885] mb-2">{label}</div>
      <div className="text-[26px] font-semibold tracking-tight leading-none" style={{ color: colors[color ?? 'white'] }}>{value}</div>
      {sub && <div className="text-[11px] text-[#7a7885] mt-1">{sub}</div>}
    </div>
  )
}

// ── Spinner ────────────────────────────────────────────────────────────────
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="spin inline-block rounded-full border border-current border-t-transparent"
      style={{ width: size, height: size }}
    />
  )
}

// ── Empty state ────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-4xl mb-3 opacity-30">{icon}</div>
      <div className="font-medium text-[#f0eff5] mb-1">{title}</div>
      {sub && <div className="text-[12px] text-[#7a7885]">{sub}</div>}
    </div>
  )
}

// ── Toggle ─────────────────────────────────────────────────────────────────
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative w-9 h-5 rounded-full transition-colors duration-200 border',
        checked
          ? 'bg-[#c8f04c] border-[#c8f04c]'
          : 'bg-[#1e1e22] border-[rgba(255,255,255,0.13)]'
      )}
    >
      <span className={clsx(
        'absolute top-0.5 w-4 h-4 rounded-full transition-transform duration-200',
        checked ? 'translate-x-4 bg-[#0f0f11]' : 'translate-x-0.5 bg-[#7a7885]'
      )} />
    </button>
  )
}

// ── Modal ──────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="bg-[#17171a] border border-[rgba(255,255,255,0.1)] rounded-xl w-full max-w-md p-6 animate-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-[15px]">{title}</h3>
          <button onClick={onClose} className="text-[#7a7885] hover:text-[#f0eff5] text-lg leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Section label ──────────────────────────────────────────────────────────
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-widest text-[#7a7885] mb-3">{children}</div>
}

// ── Dot status ─────────────────────────────────────────────────────────────
export function StatusDot({ level }: { level: string }) {
  const colors: Record<string, string> = {
    CRITICAL: '#f87171',
    WARNING:  '#fbbf24',
    INFO:     '#93c5fd',
    ON_TRACK: '#6ee7b7',
    VERIFY:   '#6ee7b7',
  }
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: colors[level] ?? '#7a7885' }}
    />
  )
}
