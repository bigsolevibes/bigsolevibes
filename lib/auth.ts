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

        const validEmail =
          credentials.email === process.env.DASHBOARD_EMAIL

        const hash = process.env.DASHBOARD_PASSWORD_HASH ?? ''
        const validPassword = hash
          ? await bcrypt.compare(credentials.password, hash)
          : false

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
