import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { asin } = await req.json()
  if (!asin || typeof asin !== 'string') {
    return Response.json({ error: 'asin required' }, { status: 400 })
  }

  try {
    const { google } = await import('googleapis')
    const fs = await import('fs')
    const path = await import('path')

    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH
    const spreadsheetId = process.env.SHEETS_PRODUCT_QUEUE_ID
    if (!keyPath || !spreadsheetId) {
      return Response.json({ error: 'Sheets not configured' }, { status: 500 })
    }

    const key = JSON.parse(fs.default.readFileSync(path.default.resolve(keyPath), 'utf8'))
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    const sheets = google.sheets({ version: 'v4', auth })

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'A:B',
    })

    const rows = res.data.values ?? []
    const headers = rows[0] as string[]
    const asinIdx = headers.findIndex((h) => h === 'ASIN')
    const statusIdx = headers.findIndex((h) => h === 'Status')

    if (asinIdx < 0 || statusIdx < 0) {
      return Response.json({ error: 'Column not found' }, { status: 500 })
    }

    const rowIndex = rows.findIndex((r, i) => i > 0 && r[asinIdx] === asin)
    if (rowIndex < 0) {
      return Response.json({ error: 'Product not found' }, { status: 404 })
    }

    const colLetter = String.fromCharCode(65 + statusIdx)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${colLetter}${rowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Approved']] },
    })

    return Response.json({ ok: true, asin, action: 'approved' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: msg }, { status: 500 })
  }
}
