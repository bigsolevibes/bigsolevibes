export interface TenantConfig {
  tenant_id: string
  brand_name: string
  primary_color: string
  accent_color: string
  logo_url: string
  platforms: string[]
  pipeline_root: string
  drive_folder: string
  sheets_id: string
}

export type AgentStatus = 'active' | 'stale' | 'error' | 'never-run' | 'inactive'

export interface AgentState {
  tier: number
  role: string
  schedule: string
  status: AgentStatus
  lastSeen: string | null
  lastError?: string
}

export interface OrgChartState {
  lastUpdated: string
  agents: Record<string, AgentState>
}

export type PlatformStatus = 'pending' | 'success' | 'error' | 'skipped' | 'exhausted' | 'hold'

export interface PlatformSlotState {
  status: PlatformStatus
  attempts: number
  postId?: string
  error?: string
  timestamp?: string
}

export interface SlotState extends Record<string, PlatformSlotState | string | boolean | undefined> {
  _media_since?: string
  _hold_since?: string
  _approval_requested?: boolean
  _caption_file?: string
}

export type WatchDriveState = Record<string, SlotState>

export interface PostRecord {
  slot: string
  platform: string
  postId: string
  timestamp: string
  status: 'success' | 'error'
  caption?: string
  mediaFile?: string
}

export interface CostState {
  date: string
  today_cost: number
  avg_daily_burn: number
  burn_days: number
  balance: number
  runway_hours: number | null
  burn_history: Array<{ date: string; cost: number }>
}

export interface ProductRow {
  name: string
  asin: string
  category: string
  description: string
  narrative: string
  score: string
  status: string
  brandStory: string
  price: string
  reasoning: string
  lockerImage: string
  imageUrl: string
  featured: string
  track: string
  crossoverSignal: string
  affiliateNetwork: string
  affiliateLink: string
}

export interface Blocker {
  name: string
  what: string
  why: string
  impact: string
  decision: string
  source: string
}

export interface ApprovalItem {
  type: 'content' | 'product'
  id: string
  slot?: string
  product?: ProductRow
  requestedAt?: string
}

export interface DashboardState {
  slots: WatchDriveState
  agents: OrgChartState
  feed: PostRecord[]
  cost: CostState | null
  blockers: Blocker[]
  approvalItems: ApprovalItem[]
}
