import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const API = process.env.WORKDECK_API_URL ?? 'https://api.workdeck.com'

export async function POST(req: NextRequest) {
  const { mail, password } = await req.json()
  if (!mail || !password) return NextResponse.json({ error: 'Email and password required' }, { status: 400 })

  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mail, password, remember: false }),
  })
  const data = await res.json()

  if (data.status !== 'OK') {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true, email: mail })
  response.cookies.set('wd_token', data.result, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8,
    path: '/',
  })
  return response
}
