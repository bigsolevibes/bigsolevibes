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

  const payload = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [
            {
              type: 'profile',
              attributes: {
                email,
                first_name: firstName,
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

  console.log('[BSV] Posting to Klaviyo, listId:', listId, 'email:', email)

  try {
    const res = await fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Klaviyo-API-Key ${apiKey}`,
        'revision':      '2023-12-15',
      },
      body: JSON.stringify(payload),
    })

    const responseText = await res.text()
    console.log('[BSV] Klaviyo response status:', res.status)
    console.log('[BSV] Klaviyo response body:', responseText)

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Klaviyo request failed.', status: res.status, detail: responseText },
        { status: 400 }
      )
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    console.error('[BSV] Klaviyo fetch threw:', err)
    return NextResponse.json({ error: 'Network error reaching Klaviyo.' }, { status: 502 })
  }
}
