import { AppShell } from '@/components/AppShell'
import { ReactNode } from 'react'

export default function ProjectLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
