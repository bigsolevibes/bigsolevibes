import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { firstName, email } = await req.json()

  if (!firstName || !email) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const apiKey = process.env.KLAVIYO_PRIVATE_API_KEY
  const listId = process.env.KLAVIYO_LIST_ID

  if (!apiKey || !listId) {
    console.error('[BSV] Klaviyo env vars not set — apiKey:', !!apiKey, 'listId:', !!listId)
    return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })
  }

  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Klaviyo-API-Key ${apiKey}`,
    'revision':      '2023-12-15',
  }

  // Step 1: Create or update the profile
  console.log('[BSV] Step 1 — creating profile for:', email)

  let profileId: string | null = null

  try {
    const profileRes = await fetch('https://a.klaviyo.com/api/profiles/', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          type: 'profile',
          attributes: { email, first_name: firstName },
        },
      }),
    })

    const profileBody = await profileRes.text()
    console.log('[BSV] Profile create status:', profileRes.status)
    console.log('[BSV] Profile create body:', profileBody)

    if (profileRes.status === 201 || profileRes.status === 200) {
      // Created — extract ID from response
      const json = JSON.parse(profileBody)
      profileId = json?.data?.id ?? null
    } else if (profileRes.status === 409) {
      // Already exists — extract ID from the conflict response
      const json = JSON.parse(profileBody)
      profileId = json?.errors?.[0]?.meta?.duplicate_profile_id ?? null
      console.log('[BSV] Profile already exists, id:', profileId)
    } else {
      const detail = profileBody
      console.error('[BSV] Profile create failed:', profileRes.status, detail)
      return NextResponse.json(
        { error: 'Failed to create profile.', status: profileRes.status, detail },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error('[BSV] Profile create threw:', err)
    return NextResponse.json({ error: 'Network error reaching Klaviyo.' }, { status: 502 })
  }

  if (!profileId) {
    console.error('[BSV] Could not determine profile ID')
    return NextResponse.json({ error: 'Could not resolve profile ID.' }, { status: 500 })
  }

  // Step 2: Add profile to list
  console.log('[BSV] Step 2 — adding profile', profileId, 'to list', listId)

  try {
    const listRes = await fetch(
      `https://a.klaviyo.com/api/lists/${listId}/relationships/profiles/`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: [{ type: 'profile', id: profileId }],
        }),
      }
    )

    const listBody = await listRes.text()
    console.log('[BSV] List add status:', listRes.status)
    console.log('[BSV] List add body:', listBody)

    // 204 = added, 200 = ok, profile may already be in list — both are success
    if (!listRes.ok && listRes.status !== 204) {
      return NextResponse.json(
        { error: 'Failed to add profile to list.', status: listRes.status, detail: listBody },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error('[BSV] List add threw:', err)
    return NextResponse.json({ error: 'Network error reaching Klaviyo.' }, { status: 502 })
  }

  console.log('[BSV] Success — profile', profileId, 'added to list', listId)
  return NextResponse.json({ ok: true }, { status: 200 })
}
