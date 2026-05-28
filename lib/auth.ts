import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const email = process.env.DASHBOARD_EMAIL
        // Hash is stored base64-encoded to survive dotenv-expand's $ substitution
        const hashB64 = process.env.DASHBOARD_PASSWORD_HASH
        const hash = hashB64 ? Buffer.from(hashB64, 'base64').toString('utf8') : ''

        if (!email || !hash) {
          console.error(
            '[dashboard auth] MISSING ENV — ' +
            (!email ? 'DASHBOARD_EMAIL ' : '') +
            (!hash ? 'DASHBOARD_PASSWORD_HASH' : '') +
            ' not set. Re-run: node scripts/dashboard-setup.js'
          )
          return null
        }

        const validEmail = credentials.email === email
        const validPassword = await bcrypt.compare(credentials.password, hash)

        if (validEmail && validPassword) {
          return { id: '1', email: credentials.email, name: 'Big D' }
        }
        return null
      },
    }),
  ],
  session: { strategy: 'jwt' },
  // NextAuth reads NEXTAUTH_SECRET automatically at request time.
  // Do not cache it here at module load — it may not be hydrated yet.
  pages: {
    signIn: '/dashboard/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.email = user.email
      return token
    },
    async session({ session, token }) {
      if (token) session.user = { email: token.email as string }
      return session
    },
  },
}
