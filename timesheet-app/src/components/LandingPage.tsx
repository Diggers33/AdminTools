'use client'

interface Tool {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  color: string
}

interface LandingPageProps {
  onSelect: (tool: string) => void
}

const tools: Tool[] = [
  {
    id: 'timesheets',
    title: 'Timesheet Verification Tool',
    description: 'Generate and verify monthly employee timesheets from REPORTS data. Upload source files, preview per-employee hours, and export formatted Excel timesheets.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="4" y="3" width="18" height="24" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M8 9h10M8 13h10M8 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="24" cy="24" r="6" fill="#1da35a" stroke="none"/>
        <path d="M21.5 24l2 2 3.5-3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    color: '#0066cc',
  },
  {
    id: 'approvals',
    title: 'Approval Checker',
    description: 'View approved expenses and purchase requests from Workdeck. Filter by period, type, and track who submitted and approved each request.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <path d="M16 3l3.09 6.26L26 10.27l-5 4.87 1.18 6.86L16 18.77l-6.18 3.23L11 15.14 6 10.27l6.91-1.01L16 3z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
        <path d="M10 26h12M13 29h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    color: '#7a3fb0',
  },
]

export default function LandingPage({ onSelect }: LandingPageProps) {
  return (
    <div style={{ minHeight: '100vh', background: '#f0f4fa', fontFamily: "'Georgia', serif", display: 'flex', flexDirection: 'column' }}>
      {/* Hero */}
      <div style={{ background: '#0d1f3c', borderBottom: '1px solid #0a1830', padding: '60px 40px 52px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ fontSize: 10, letterSpacing: 4, color: '#4a7ab8', textTransform: 'uppercase', marginBottom: 12 }}>
            IRIS · Internal Admin Tools
          </div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 400, color: '#ffffff', letterSpacing: 0.5, lineHeight: 1.2 }}>
            Admin Tool Suite
          </h1>
          <p style={{ margin: '12px 0 0', fontSize: 14, color: '#5a8abf', lineHeight: 1.6, maxWidth: 520 }}>
            A collection of internal tools for managing timesheets, approvals, and operational data.
          </p>
        </div>
      </div>

      {/* Tools grid */}
      <div style={{ flex: 1, maxWidth: 900, margin: '0 auto', padding: '48px 40px', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#8aaac8', marginBottom: 24 }}>
          Available Tools
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 20,
        }}>
          {tools.map(tool => (
            <ToolCard key={tool.id} tool={tool} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ToolCard({ tool, onSelect }: { tool: Tool; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(tool.id)}
      style={{
        background: '#ffffff',
        border: '1px solid #c8d8ed',
        borderRadius: 12,
        padding: '28px 24px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.18s',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        fontFamily: "'Georgia', serif",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget
        el.style.borderColor = tool.color
        el.style.boxShadow = `0 4px 20px rgba(0,0,0,0.08)`
        el.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget
        el.style.borderColor = '#c8d8ed'
        el.style.boxShadow = 'none'
        el.style.transform = 'translateY(0)'
      }}
    >
      {/* Icon */}
      <div style={{
        width: 56, height: 56, borderRadius: 12,
        background: `${tool.color}12`,
        border: `1px solid ${tool.color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: tool.color,
        flexShrink: 0,
      }}>
        {tool.icon}
      </div>

      {/* Text */}
      <div>
        <div style={{ fontSize: 15, color: '#0d1f3c', fontWeight: 400, marginBottom: 8, letterSpacing: 0.2 }}>
          {tool.title}
        </div>
        <div style={{ fontSize: 12, color: '#5a7a9a', lineHeight: 1.6 }}>
          {tool.description}
        </div>
      </div>

      {/* Arrow */}
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6, color: tool.color, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}>
        Open
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </button>
  )
}
