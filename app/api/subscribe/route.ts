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

  // Step 1: Subscribe email to list — no first_name in this payload
  const subPayload = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [
            {
              type: 'profile',
              attributes: {
                email,
                subscriptions: {
                  email: {
                    marketing: { consent: 'SUBSCRIBED' },
                  },
                },
              },
            },
          ],
        },
      },
      relationships: {
        list: {
          data: { type: 'list', id: listId },
        },
      },
    },
  }

  console.log('[BSV] Step 1 — subscribing to list, listId:', listId, 'email:', email)

  try {
    const subRes = await fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
      method: 'POST',
      headers,
      body: JSON.stringify(subPayload),
    })

    const subBody = await subRes.text()
    console.log('[BSV] Klaviyo subscribe status:', subRes.status)
    console.log('[BSV] Klaviyo subscribe body:', subBody)

    if (!subRes.ok) {
      return NextResponse.json(
        { error: 'Klaviyo subscription failed.', status: subRes.status, detail: subBody },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error('[BSV] Klaviyo subscribe fetch threw:', err)
    return NextResponse.json({ error: 'Network error reaching Klaviyo.' }, { status: 502 })
  }

  // Step 2: Find the profile by email then PATCH first_name onto it
  // Search for the profile ID first
  console.log('[BSV] Step 2 — fetching profile by email to patch first_name')

  try {
    const searchRes = await fetch(
      `https://a.klaviyo.com/api/profiles/?filter=equals(email,"${encodeURIComponent(email)}")`,
      { method: 'GET', headers }
    )

    const searchBody = await searchRes.text()
    console.log('[BSV] Klaviyo profile search status:', searchRes.status)
    console.log('[BSV] Klaviyo profile search body:', searchBody)

    if (searchRes.ok) {
      const searchJson = JSON.parse(searchBody)
      const profileId  = searchJson?.data?.[0]?.id

      if (profileId) {
        const patchRes = await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            data: {
              type: 'profile',
              id:   profileId,
              attributes: { first_name: firstName },
            },
          }),
        })
        const patchBody = await patchRes.text()
        console.log('[BSV] Klaviyo PATCH status:', patchRes.status)
        console.log('[BSV] Klaviyo PATCH body:', patchBody)
      } else {
        console.warn('[BSV] Profile not found in search — first_name not patched')
      }
    }
  } catch (err) {
    // Non-fatal — subscription succeeded, first_name patch is best-effort
    console.error('[BSV] Profile patch threw (non-fatal):', err)
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
