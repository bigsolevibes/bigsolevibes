import { NextResponse, type NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Auth endpoints and login page are always accessible
  if (
    pathname === '/dashboard/login' ||
    pathname.startsWith('/api/auth/')
  ) {
    return NextResponse.next()
  }

  // Protect all other /dashboard/* routes
  const secret =
    process.env.DASHBOARD_SECRET ?? process.env.NEXTAUTH_SECRET ?? ''
  const token = secret ? await getToken({ req, secret }) : null

  if (!token) {
    const loginUrl = new URL('/dashboard/login', req.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
