import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { firstName, email } = await req.json()

  if (!firstName || !email) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const apiKey = process.env.KLAVIYO_PRIVATE_API_KEY
  const listId = process.env.KLAVIYO_LIST_ID

  if (!apiKey || !listId) {
    console.error('Klaviyo env vars not set')
    return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })
  }

  const headers = {
    'Authorization': `Klaviyo-API-Key ${apiKey}`,
    'Content-Type':  'application/json',
    'revision':      '2024-02-15',
  }

  // Step 1: Create/upsert the profile so first_name is stored.
  // 201 = created, 409 = already exists — both are fine, we continue either way.
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

  if (!profileRes.ok && profileRes.status !== 409) {
    const body = await profileRes.text()
    console.error('Klaviyo profile create error', profileRes.status, body)
    return NextResponse.json({ error: 'Failed to create profile.' }, { status: 502 })
  }

  // Step 2: Subscribe the profile to the list.
  // The subscription bulk-create endpoint only accepts email + subscriptions — no first_name.
  const subRes = await fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
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
    }),
  })

  if (!subRes.ok) {
    const body = await subRes.text()
    console.error('Klaviyo subscribe error', subRes.status, body)
    return NextResponse.json({ error: 'Failed to subscribe.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
