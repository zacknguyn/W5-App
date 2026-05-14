export type View = 'dashboard' | 'alerts' | 'detail' | 'settings'
export type Priority = 'high' | 'standard'
export type AlertFilter = 'all' | Priority
export type ApiStatus = 'seed' | 'syncing' | 'live' | 'error'

export type Asset = {
  ticker: string
  title: string
  price: number
  changePercent: number
  marketCap: string
  peRatio: number | null
  rank: number | null
  watched: boolean
  lastUpdated: string
  trend: number[]
  chart: ChartPoint[]
}

export type ChartPoint = {
  label: string
  price: number
  thresholdHigh: number
  thresholdLow: number
  volume: number
  alert?: Priority
}

export type Alert = {
  id: string
  ticker: string
  priceAtEvent: number
  message: string
  priority: Priority
  createdAt: string
  read: boolean
}

export type Settings = {
  thresholdPercent: number
  emailEnabled: boolean
  smsEnabled: boolean
}

export type BackendMeta = {
  monitoredCount: number
  vn30Count: number
  cacheTtlSeconds: number
  source: string
}
