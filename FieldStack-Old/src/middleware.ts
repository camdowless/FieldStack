import { withAuth } from 'next-auth/middleware'

export default withAuth({
  pages: { signIn: '/login' },
})

export const config = {
  matcher: [
    '/((?!api/auth|api/steps/magic|api/gmail/callback|tasks/action|login|signup|_next/static|_next/image|favicon.ico).*)',
  ],
}
