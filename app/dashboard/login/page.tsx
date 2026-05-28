'use client'

import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const fd = new FormData(e.currentTarget)
    const result = await signIn('credentials', {
      email: fd.get('email'),
      password: fd.get('password'),
      redirect: false,
    })

    setLoading(false)
    if (result?.ok) {
      router.push('/dashboard/overview')
    } else {
      setError('Invalid credentials.')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bsv-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-heading text-4xl tracking-wider text-bsv-cream">
            BSV
          </h1>
          <p className="mt-1 text-sm text-bsv-muted">Control Room</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-bsv-surface bg-bsv-card p-6 shadow-xl"
        >
          <div className="mb-4">
            <label
              htmlFor="email"
              className="mb-1 block text-xs font-medium text-bsv-muted"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded border border-bsv-surface bg-bsv-surface px-3 py-2.5 text-sm text-bsv-cream placeholder-bsv-muted/50 focus:border-bsv-amber focus:outline-none"
              placeholder="you@example.com"
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-medium text-bsv-muted"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded border border-bsv-surface bg-bsv-surface px-3 py-2.5 text-sm text-bsv-cream placeholder-bsv-muted/50 focus:border-bsv-amber focus:outline-none"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="mb-4 rounded bg-red-950/50 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-bsv-amber py-3 text-sm font-semibold text-bsv-bg transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
