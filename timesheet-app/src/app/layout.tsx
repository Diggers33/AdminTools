import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'IRIS Timesheets Verification Tool',
  description: 'Auto-populate and verify employee timesheets from monthly REPORTS data',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  )
}
