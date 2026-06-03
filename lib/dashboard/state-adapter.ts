import fs from 'fs'
import path from 'path'
import type {
  WatchDriveState,
  OrgChartState,
  PostRecord,
  CostState,
  Blocker,
  ApprovalItem,
  ProductRow,
} from './types'

const PIPELINE_ROOT = process.env.PIPELINE_ROOT ?? process.cwd()

function readJson<T>(relPath: string): T | null {
  try {
    const full = path.join(PIPELINE_ROOT, relPath)
    return JSON.parse(fs.readFileSync(full, 'utf-8')) as T
  } catch {
    return null
  }
}

function readText(relPath: string): string | null {
  try {
    const full = path.join(PIPELINE_ROOT, relPath)
    return fs.readFileSync(full, 'utf-8')
  } catch {
    return null
  }
}

function latestFile(dir: string, prefix: string): string | null {
  try {
    const full = path.join(PIPELINE_ROOT, dir)
    const files = fs.readdirSync(full)
    const matches = files
      .filter(f => f.startsWith(prefix))
      .sort()
      .reverse()
    return matches[0] ? path.join(full, matches[0]) : null
  } catch {
    return null
  }
}

export class StateAdapter {
  static getSlots(_tenantId: string): WatchDriveState {
    return readJson<WatchDriveState>('logs/watch-drive-state.json') ?? {}
  }

  static getAgents(_tenantId: string): OrgChartState {
    return (
      readJson<OrgChartState>('logs/org-chart-state.json') ?? {
        lastUpdated: new Date().toISOString(),
        agents: {},
      }
    )
  }

  static getFeed(_tenantId: string): PostRecord[] {
    return readJson<PostRecord[]>('logs/post-state.json') ?? []
  }

  static getCost(_tenantId: string): CostState | null {
    return readJson<CostState>('logs/cost-state.json')
  }

  static getLatestStandup(_tenantId: string): string | null {
    const logsDir = path.join(PIPELINE_ROOT, 'logs')
    try {
      const files = fs.readdirSync(logsDir)
      const standups = files
        .filter(f => f.startsWith('standup-') && f.endsWith('.txt'))
        .sort()
        .reverse()
      if (standups[0]) {
        return fs.readFileSync(path.join(logsDir, standups[0]), 'utf-8')
      }
    } catch {
      /* ignore */
    }
    return null
  }

  static getEngBotLog(_tenantId: string): string | null {
    return readText('logs/eng-bot.log')
  }

  static extractBlockers(
    standup: string | null,
    _slots: WatchDriveState,
    agents: OrgChartState
  ): Blocker[] {
    const blockers: Blocker[] = []

    // Agents in error state become blockers
    for (const [name, agent] of Object.entries(agents.agents)) {
      if (agent.status === 'error' && agent.lastError) {
        blockers.push({
          name: `${name} error`,
          what: agent.lastError,
          why: `${name} last ran ${agent.lastSeen ? new Date(agent.lastSeen).toLocaleString() : 'never'}`,
          impact: `${agent.role} is not running`,
          decision: `Check logs/${name}.log and resolve the error`,
          source: 'org-chart',
        })
      }
    }

    // Parse standup blockers section
    if (standup) {
      const blockersSection = standup.match(/BLOCKERS[\s\S]*?(?=\n\*\d|$)/i)
      if (blockersSection) {
        const text = blockersSection[0]
        if (!text.includes('No decisions needed') && !text.includes('No blockers')) {
          const lines = text
            .split('\n')
            .filter(l => l.trim() && !l.match(/^\*\d/))
            .slice(1)
          if (lines.length > 0) {
            blockers.push({
              name: 'Standup blocker',
              what: lines.join(' ').trim(),
              why: 'Reported in morning standup',
              impact: 'Requires Big D decision',
              decision: 'Review standup for details',
              source: 'standup',
            })
          }
        }
      }
    }

    return blockers
  }

  static getApprovalItems(slots: WatchDriveState): ApprovalItem[] {
    const items: ApprovalItem[] = []
    for (const [slotName, slot] of Object.entries(slots)) {
      if (slot._approval_requested === true) {
        items.push({
          type: 'content',
          id: slotName,
          slot: slotName,
          requestedAt: slot._media_since as string | undefined,
        })
      }
    }
    return items
  }

  static writeApproval(
    _tenantId: string,
    slot: string,
    action: 'approved' | 'denied',
    reason?: string
  ): void {
    const filePath = path.join(PIPELINE_ROOT, 'logs/approved-slots.json')
    let existing: Array<Record<string, unknown>> = []
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    } catch {
      /* file doesn't exist yet — start fresh */
    }
    existing = existing.filter((e) => e.slot !== slot)
    existing.push({
      slot,
      action,
      timestamp: new Date().toISOString(),
      approvedBy: 'dashboard',
      ...(reason ? { reason } : {}),
    })
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2))
  }

  static async getShelf(
    _tenantId: string
  ): Promise<{ active: ProductRow[]; pending: ProductRow[] }> {
    try {
      const { google } = await import('googleapis')
      const fsModule = await import('fs')
      const pathModule = await import('path')

      const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH
      const spreadsheetId =
        process.env.SHEETS_PRODUCT_QUEUE_ID

      if (!keyPath || !spreadsheetId) {
        return { active: [], pending: [] }
      }

      const key = JSON.parse(
        fsModule.default.readFileSync(pathModule.default.resolve(keyPath), 'utf8')
      )
      const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      })
      const sheets = google.sheets({ version: 'v4', auth })

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'A1:Q200',
      })

      const rows = res.data.values ?? []
      if (rows.length < 2) return { active: [], pending: [] }

      const headers = rows[0] as string[]
      const idx = (name: string) =>
        headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())

      const parseRow = (row: string[]): ProductRow => ({
        name: row[idx('Product Name')] ?? '',
        asin: row[idx('ASIN')] ?? '',
        category: row[idx('Category')] ?? '',
        description: row[idx('Description')] ?? '',
        narrative: row[idx('Narrative')] ?? '',
        score: row[idx('Score')] ?? '',
        status: row[idx('Status')] ?? '',
        brandStory: row[idx('Brand Story')] ?? '',
        price: row[idx('Price')] ?? '',
        reasoning: row[idx('Reasoning')] ?? '',
        lockerImage: row[idx('Locker Image')] ?? '',
        imageUrl: row[idx('Image_URL')] ?? '',
        featured: row[idx('Featured')] ?? '',
        track: row[idx('Track')] ?? '',
        crossoverSignal: row[idx('Crossover Signal')] ?? '',
        affiliateNetwork: row[idx('Affiliate Network')] ?? '',
        affiliateLink: row[idx('Affiliate Link')] ?? '',
      })

      const dataRows = rows.slice(1).map(parseRow)
      const active = dataRows.filter(
        (r) => r.status.toLowerCase() === 'approved'
      )
      const pending = dataRows.filter(
        (r) =>
          r.status.toLowerCase() === 'pending' ||
          r.status.toLowerCase() === 'scored' ||
          r.status.toLowerCase() === ''
      )

      return { active, pending }
    } catch {
      return { active: [], pending: [] }
    }
  }
}
