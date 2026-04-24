export async function onRequestPost(context: any) {
  const { firstName, email } = await context.request.json()

  if (!firstName || !email) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const apiKey = context.env.KLAVIYO_PRIVATE_API_KEY
  const listId = context.env.KLAVIYO_LIST_ID
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Klaviyo-API-Key ${apiKey}`,
    'revision': '2023-12-15',
  }

  // Step 1: Create profile
  let profileId: string | null = null
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

  const profileBody = await profileRes.json() as any
  if (profileRes.status === 201 || profileRes.status === 200) {
    profileId = profileBody?.data?.id ?? null
  } else if (profileRes.status === 409) {
    profileId = profileBody?.errors?.[0]?.meta?.duplicate_profile_id ?? null
  } else {
    return new Response(JSON.stringify({ error: 'Profile creation failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (!profileId) {
    return new Response(JSON.stringify({ error: 'Could not resolve profile ID' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Step 2: Add to list
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

  if (!listRes.ok && listRes.status !== 204) {
    return new Response(JSON.stringify({ error: 'Failed to add to list' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
