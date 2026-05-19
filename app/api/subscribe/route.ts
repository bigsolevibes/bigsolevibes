import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { email, firstName } = await req.json()

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const apiKey = process.env.KLAVIYO_API_KEY
  const listId = process.env.KLAVIYO_LOUNGE_LIST_ID

  if (!apiKey || !listId) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const headers = {
    'Authorization': `Klaviyo-API-Key ${apiKey}`,
    'Content-Type': 'application/vnd.api+json',
    'revision': '2024-10-15',
  }

  // Step 1: upsert profile
  const profileRes = await fetch('https://a.klaviyo.com/api/profiles/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: {
        type: 'profile',
        attributes: {
          email,
          ...(firstName ? { first_name: firstName } : {}),
        },
      },
    }),
  })

  let profileId: string
  if (profileRes.status === 201) {
    const body = await profileRes.json()
    profileId = body.data.id
  } else if (profileRes.status === 409) {
    // Profile already exists — extract the duplicate id
    const body = await profileRes.json()
    profileId = body.errors?.[0]?.meta?.duplicate_profile_id
    if (!profileId) {
      return NextResponse.json({ error: 'Profile conflict' }, { status: 500 })
    }
  } else {
    const body = await profileRes.json().catch(() => ({}))
    console.error('[subscribe] profile upsert failed', profileRes.status, body)
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 })
  }

  // Step 2: subscribe profile to list
  const subRes = await fetch(
    `https://a.klaviyo.com/api/lists/${listId}/relationships/profiles/`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: [{ type: 'profile', id: profileId }],
      }),
    }
  )

  // 204 = success, 400 may mean already subscribed (acceptable)
  if (subRes.status !== 204 && subRes.status !== 200 && subRes.status !== 400) {
    const body = await subRes.json().catch(() => ({}))
    console.error('[subscribe] list add failed', subRes.status, body)
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
