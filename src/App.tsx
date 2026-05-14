import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  fetchAlerts,
  fetchAssets,
  fetchMeta,
  fetchSettings,
  hasApiBaseUrl,
  markAlertRead,
  saveSettings,
  updateAssetWatch,
} from './lib/api'
import { formatMarketDate, formatMarketTime, formatVnd } from './lib/format'
import type { Alert, AlertFilter, ApiStatus, Asset, BackendMeta, Settings, View } from './types'
import './App.css'

const AssetPriceChart = lazy(() =>
  import('./components/AssetPriceChart').then((module) => ({
    default: module.AssetPriceChart,
  })),
)

type MarketUniverse = 'all' | 'top30'
type MarketActivity = 'none' | 'movers' | 'top10' | 'bottom10'
type MarketSort = 'ticker' | 'price' | 'change' | 'rank'

type AppState = {
  assets: Asset[]
  alerts: Alert[]
  meta: BackendMeta
  settings: Settings
}

type Action =
  | { type: 'replace-assets'; assets: Asset[] }
  | { type: 'replace-alerts'; alerts: Alert[] }
  | { type: 'replace-meta'; meta: BackendMeta }
  | { type: 'replace-settings'; settings: Settings }
  | { type: 'set-watch'; ticker: string; watched: boolean }
  | { type: 'mark-alert-read'; id: string }
  | { type: 'save-settings'; settings: Settings }

const initialState: AppState = {
  assets: [],
  alerts: [],
  meta: {
    monitoredCount: 100,
    vn30Count: 30,
    cacheTtlSeconds: 60,
    source: 'KBS',
  },
  settings: {
    thresholdPercent: 5,
    emailEnabled: true,
    smsEnabled: false,
  },
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'replace-assets':
      return { ...state, assets: action.assets }
    case 'replace-alerts':
      return { ...state, alerts: action.alerts }
    case 'replace-meta':
      return { ...state, meta: action.meta }
    case 'replace-settings':
      return { ...state, settings: action.settings }
    case 'set-watch':
      return {
        ...state,
        assets: state.assets.map((asset) =>
          asset.ticker === action.ticker
            ? { ...asset, watched: action.watched }
            : asset,
        ),
      }
    case 'mark-alert-read':
      return {
        ...state,
        alerts: state.alerts.map((alert) =>
          alert.id === action.id ? { ...alert, read: true } : alert,
        ),
      }
    case 'save-settings':
      return { ...state, settings: action.settings }
  }
}

function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [activeView, setActiveView] = useState<View>('dashboard')
  const [selectedTicker, setSelectedTicker] = useState('')
  const [assetQuery, setAssetQuery] = useState('')
  const [marketUniverse, setMarketUniverse] = useState<MarketUniverse>('all')
  const [marketActivity, setMarketActivity] = useState<MarketActivity>('none')
  const [isWatchedOnly, setIsWatchedOnly] = useState(false)
  const [isCompact, setIsCompact] = useState(false)
  const [marketSort, setMarketSort] = useState<MarketSort>('ticker')
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all')
  const [apiStatus, setApiStatus] = useState<ApiStatus>(hasApiBaseUrl ? 'syncing' : 'seed')
  const [apiMessage, setApiMessage] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  const syncMarketData = useCallback(async () => {
    if (!hasApiBaseUrl) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setApiStatus('syncing')
    setApiMessage('')

    try {
      const [alerts, settings, meta] = await Promise.all([
        fetchAlerts(controller.signal),
        fetchSettings(controller.signal),
        fetchMeta(controller.signal),
      ])

      dispatch({ type: 'replace-alerts', alerts })
      dispatch({ type: 'replace-settings', settings })
      dispatch({ type: 'replace-meta', meta })

      const assets = await fetchAssets(controller.signal)
      dispatch({ type: 'replace-assets', assets })
      if (!selectedTicker && assets[0]) {
        setSelectedTicker(assets[0].ticker)
      }
      setApiStatus('live')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return

      const message =
        error instanceof Error ? error.message : 'Market data request failed'
      setApiStatus('error')
      setApiMessage(message)
    }
  }, [selectedTicker])

  useEffect(() => {
    const initialSyncId = window.setTimeout(syncMarketData, 0)
    const initialSyncId2 = window.setTimeout(syncMarketData, 500)
    const intervalId = window.setInterval(syncMarketData, 45_000)

    return () => {
      controllerRef.current?.abort()
      window.clearTimeout(initialSyncId)
      window.clearTimeout(initialSyncId2)
      window.clearInterval(intervalId)
    }
  }, [syncMarketData])

  const handleToggleWatch = useCallback(async (ticker: string) => {
    const asset = state.assets.find((item) => item.ticker === ticker)
    if (!asset) return

    const watched = !asset.watched
    dispatch({ type: 'set-watch', ticker, watched })

    try {
      const updatedAsset = await updateAssetWatch(ticker, watched)
      dispatch({
        type: 'set-watch',
        ticker: updatedAsset.ticker,
        watched: updatedAsset.watched,
      })
      setApiStatus('live')
    } catch (error) {
      dispatch({ type: 'set-watch', ticker, watched: asset.watched })
      setApiStatus('error')
      setApiMessage(error instanceof Error ? error.message : 'Watchlist update failed')
    }
  }, [state.assets])

  const handleMarkAlertRead = useCallback(async (id: string) => {
    dispatch({ type: 'mark-alert-read', id })

    try {
      await markAlertRead(id)
      setApiStatus('live')
    } catch (error) {
      setApiStatus('error')
      setApiMessage(error instanceof Error ? error.message : 'Alert update failed')
    }
  }, [])

  const handleSaveSettings = useCallback(async (settings: Settings) => {
    dispatch({ type: 'save-settings', settings })

    try {
      const savedSettings = await saveSettings(settings)
      dispatch({ type: 'replace-settings', settings: savedSettings })
      setApiStatus('live')
    } catch (error) {
      setApiStatus('error')
      setApiMessage(error instanceof Error ? error.message : 'Settings update failed')
    }
  }, [])

  const selectedAsset =
    state.assets.find((asset) => asset.ticker === selectedTicker) ??
    state.assets[0]

  const visibleAssets = useMemo(() => {
    let filtered = filterAssets(state.assets, assetQuery)
    if (marketUniverse === 'top30') {
      filtered = filtered.filter((a) => a.rank !== null)
    }

    if (isWatchedOnly) {
      filtered = filtered.filter((a) => a.watched)
    }

    if (marketActivity === 'movers') {
      filtered = [...filtered].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    } else if (marketActivity === 'top10') {
      filtered = [...filtered].sort((a, b) => b.changePercent - a.changePercent).slice(0, 10)
    } else if (marketActivity === 'bottom10') {
      filtered = [...filtered].sort((a, b) => a.changePercent - b.changePercent).slice(0, 10)
    }

    return [...filtered].sort((a, b) => {
      if (marketSort === 'price') return b.price - a.price
      if (marketSort === 'change') return b.changePercent - a.changePercent
      if (marketSort === 'rank') {
        const rA = a.rank ?? 999
        const rB = b.rank ?? 999
        return rA - rB
      }

      if (marketUniverse === 'top30' && marketSort === 'ticker') {
        const rA = a.rank ?? 999
        const rB = b.rank ?? 999
        return rA - rB
      }
      
      if (marketActivity === 'movers' && marketSort === 'ticker') {
        return Math.abs(b.changePercent) - Math.abs(a.changePercent)
      }

      if (marketActivity === 'top10' && marketSort === 'ticker') {
        return b.changePercent - a.changePercent
      }

      if (marketActivity === 'bottom10' && marketSort === 'ticker') {
        return a.changePercent - b.changePercent
      }

      return a.ticker.localeCompare(b.ticker)
    })
  }, [state.assets, assetQuery, marketUniverse, marketActivity, isWatchedOnly, marketSort])

  const filteredAlerts = state.alerts.filter((alert) =>
    alertFilter === 'all' ? true : alert.priority === alertFilter,
  )

  const watchedCount = state.assets.filter((asset) => asset.watched).length
  const priorityCount = state.assets.filter((asset) => asset.rank !== null).length
  const unreadCount = state.alerts.filter((alert) => !alert.read).length
  const displayedAssetCount = state.assets.length || state.meta.monitoredCount
  const displayedPriorityCount = priorityCount || state.meta.vn30Count

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">M</span>
          <div>
            <p className="eyebrow">Real-time surveillance</p>
            <strong>Market Monitor</strong>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary navigation">
          <NavButton current={activeView === 'dashboard'} onClick={() => setActiveView('dashboard')}>
            Dashboard
          </NavButton>
          <NavButton current={activeView === 'alerts'} onClick={() => setActiveView('alerts')}>
            Alerts
          </NavButton>
          <NavButton current={activeView === 'detail'} onClick={() => setActiveView('detail')}>
            Assets
          </NavButton>
          <NavButton current={activeView === 'settings'} onClick={() => setActiveView('settings')}>
            Infrastructure
          </NavButton>
        </nav>
      </header>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-copy">
            <p className="eyebrow">Vietnam Stock Exchange</p>
            <h1>{viewTitle(activeView)}</h1>
            <p>
              Monitoring {displayedAssetCount} active symbols with priority
              routing for VN30 constituents. Alerts are captured 24/7 and
              synced with market session windows.
            </p>
          </div>
          <div className="topbar-status">
            <StatusPill status={apiStatus} />
            <span className="market-session-badge">Session {state.meta.source}</span>
          </div>
        </header>

        <ApiNotice
          status={apiStatus}
          message={apiMessage}
          onRetry={syncMarketData}
        />

        <section className="metric-strip" aria-label="Market summary">
          <SummaryMetric label="Market universe" value={displayedAssetCount.toString()} />
          <SummaryMetric label="Watchlist" value={watchedCount.toString()} />
          <SummaryMetric label="Priority assets" value={displayedPriorityCount.toString()} />
          <SummaryMetric label="Pending alerts" value={unreadCount.toString()} />
        </section>

        {activeView === 'dashboard' && (
          <Dashboard
            assets={visibleAssets}
            allAssets={state.assets}
            alerts={state.alerts}
            selectedAsset={selectedAsset}
            meta={state.meta}
            apiStatus={apiStatus}
            assetQuery={assetQuery}
            marketUniverse={marketUniverse}
            marketActivity={marketActivity}
            isWatchedOnly={isWatchedOnly}
            isCompact={isCompact}
            marketSort={marketSort}
            onOpenAlerts={() => setActiveView('alerts')}
            onMarkRead={handleMarkAlertRead}
            onAssetQueryChange={setAssetQuery}
            onUniverseChange={setMarketUniverse}
            onActivityChange={setMarketActivity}
            onToggleWatchedOnly={() => setIsWatchedOnly(!isWatchedOnly)}
            onToggleCompact={() => setIsCompact(!isCompact)}
            onMarketSortChange={setMarketSort}
            onSelectAsset={(ticker) => setSelectedTicker(ticker)}
            onToggleWatch={handleToggleWatch}
          />
        )}

        {activeView === 'alerts' && (
          <AlertCenter
            alerts={filteredAlerts}
            activeFilter={alertFilter}
            onFilterChange={setAlertFilter}
            onMarkRead={handleMarkAlertRead}
          />
        )}

        {activeView === 'detail' && selectedAsset && (
          <AssetDetail
            asset={selectedAsset}
            assets={state.assets}
            onSelect={(ticker) => setSelectedTicker(ticker)}
            onToggleWatch={handleToggleWatch}
          />
        )}

        {activeView === 'settings' && (
          <SettingsPanel
            settings={state.settings}
            meta={state.meta}
            apiStatus={apiStatus}
            onSave={handleSaveSettings}
          />
        )}
      </main>
    </div>
  )
}

function NavButton({
  children,
  current,
  onClick,
}: {
  children: string
  current: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="nav-button"
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function StatusPill({ status }: { status: 'seed' | 'syncing' | 'live' | 'error' }) {
  const label = {
    seed: 'Pending',
    syncing: 'Syncing',
    live: 'Live',
    error: 'Offline',
  }[status]

  return <span className={`status-pill status-${status}`}>{label}</span>
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ApiNotice({
  status,
  message,
  onRetry,
}: {
  status: ApiStatus
  message: string
  onRetry: () => void
}) {
  if (status === 'live' || status === 'syncing') return null

  if (status === 'seed') {
    return (
      <aside className="notice" aria-label="Data source">
        <div>
          <strong>Connecting to market feed</strong>
          <p>The monitoring engine is initializing. Asset data will appear shortly.</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="notice notice-error" role="alert">
      <div>
        <strong>Connection interrupted</strong>
        <p>{message || 'The display is currently showing cached market data.'}</p>
      </div>
      <button type="button" className="secondary-button" onClick={onRetry}>
        Reconnect
      </button>
    </aside>
  )
}

function EmptyState({
  title,
  children,
  actionLabel,
  onAction,
}: {
  title: string
  children: ReactNode
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="empty-state">
      <span className="empty-glyph" aria-hidden="true">M</span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
      {actionLabel && onAction && (
        <button type="button" className="secondary-button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}

function Dashboard({
  assets,
  allAssets,
  selectedAsset,
  meta,
  apiStatus,
  alerts,
  assetQuery,
  marketUniverse,
  marketActivity,
  isWatchedOnly,
  isCompact,
  marketSort,
  onOpenAlerts,
  onMarkRead,
  onAssetQueryChange,
  onUniverseChange,
  onActivityChange,
  onToggleWatchedOnly,
  onToggleCompact,
  onMarketSortChange,
  onSelectAsset,
  onToggleWatch,
}: {
  assets: Asset[]
  allAssets: Asset[]
  selectedAsset?: Asset
  meta: BackendMeta
  apiStatus: ApiStatus
  alerts: Alert[]
  assetQuery: string
  marketUniverse: MarketUniverse
  marketActivity: MarketActivity
  isWatchedOnly: boolean
  isCompact: boolean
  marketSort: MarketSort
  onOpenAlerts: () => void
  onMarkRead: (id: string) => void
  onAssetQueryChange: (query: string) => void
  onUniverseChange: (u: MarketUniverse) => void
  onActivityChange: (a: MarketActivity) => void
  onToggleWatchedOnly: () => void
  onToggleCompact: () => void
  onMarketSortChange: (sort: MarketSort) => void
  onSelectAsset: (ticker: string) => void
  onToggleWatch: (ticker: string) => void
}) {
  const activeAlerts = alerts
    .filter((alert) => !alert.read)
    .slice(0, 4)

  return (
    <section className="console-grid" aria-labelledby="dashboard-title">
      <div className={isCompact ? 'panel market-panel market-panel-compact' : 'panel market-panel'}>
        <div className="panel-heading panel-heading-complex">
          <div className="market-header-main">
            <div>
              <p className="eyebrow">Global Screener</p>
              <h2 id="dashboard-title">Market Watch</h2>
            </div>
            <div className="market-actions-primary">
              <button
                type="button"
                className={isWatchedOnly ? 'icon-button active' : 'icon-button'}
                title="Filter by Watchlist"
                aria-pressed={isWatchedOnly}
                onClick={onToggleWatchedOnly}
              >
                <span className="sr-only">Watched</span>
                ★
              </button>
              <button
                type="button"
                className={isCompact ? 'icon-button active' : 'icon-button'}
                title="Compact density"
                aria-pressed={isCompact}
                onClick={onToggleCompact}
              >
                <span className="sr-only">Compact</span>
                ≡
              </button>
              <label className="search-field">
                <span className="sr-only">Search symbols</span>
                <input
                  type="search"
                  value={assetQuery}
                  placeholder="Filter..."
                  onChange={(event) => onAssetQueryChange(event.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="market-filters-layered">
            <div className="filter-group">
              <span className="filter-label">Universe</span>
              <div className="segmented">
                {(['all', 'top30'] as MarketUniverse[]).map((u) => (
                  <button
                    type="button"
                    key={u}
                    aria-pressed={marketUniverse === u}
                    onClick={() => onUniverseChange(u)}
                  >
                    {u === 'all' ? 'All' : 'VN30'}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <span className="filter-label">Activity</span>
              <div className="segmented">
                {(['none', 'movers', 'top10', 'bottom10'] as MarketActivity[]).map((a) => (
                  <button
                    type="button"
                    key={a}
                    aria-pressed={marketActivity === a}
                    onClick={() => onActivityChange(a)}
                  >
                    {a === 'none' ? 'None' : a === 'movers' ? 'Movers' : a === 'top10' ? 'Top 10' : 'Bottom 10'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {allAssets.length === 0 ? (
          <EmptyState title="Awaiting market data">
            Surveillance is active but no symbols have been indexed yet.
            Ensure the data provider is reachable.
          </EmptyState>
        ) : assets.length === 0 ? (
          <EmptyState title="No assets match criteria">
            Adjust filters or search query to broaden results.
          </EmptyState>
        ) : (
          <div className="asset-table">
            <table>
              <caption>Real-time market surveillance</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <button className="sort-trigger" onClick={() => onMarketSortChange('ticker')}>
                      Asset {marketSort === 'ticker' && '↓'}
                    </button>
                  </th>
                  <th scope="col">
                    <button className="sort-trigger" onClick={() => onMarketSortChange('rank')}>
                      Status {marketSort === 'rank' && '↓'}
                    </button>
                  </th>
                  <th scope="col">
                    <button className="sort-trigger" onClick={() => onMarketSortChange('price')}>
                      Price {marketSort === 'price' && '↓'}
                    </button>
                  </th>
                  <th scope="col">
                    <button className="sort-trigger" onClick={() => onMarketSortChange('change')}>
                      Last Session {marketSort === 'change' && '↓'}
                    </button>
                  </th>
                  <th scope="col">Trend</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr
                    key={asset.ticker}
                    className={selectedAsset?.ticker === asset.ticker ? 'selected-row' : undefined}
                  >
                    <td data-label="Asset">
                      <button
                        type="button"
                        className={selectedAsset?.ticker === asset.ticker ? 'asset-action selected' : 'asset-action'}
                        aria-current={selectedAsset?.ticker === asset.ticker ? 'true' : undefined}
                        onClick={() => onSelectAsset(asset.ticker)}
                      >
                        <span className="asset-icon">{asset.ticker.slice(0, 1)}</span>
                        <span>
                          <strong>{asset.title}</strong>
                          <small>{asset.ticker}</small>
                        </span>
                      </button>
                    </td>
                    <td data-label="Status">
                      {asset.rank ? (
                        <span className="badge high">VN30 · #{asset.rank}</span>
                      ) : (
                        <span className="muted">Standard</span>
                      )}
                    </td>
                    <td className="number" data-label="Price">{formatVnd(asset.price)}</td>
                    <td className={asset.changePercent >= 0 ? 'number up' : 'number down'} data-label="Last session">
                      {asset.changePercent >= 0 ? '+' : ''}
                      {asset.changePercent.toFixed(2)}%
                    </td>
                    <td data-label="Trend">
                      <Sparkline values={asset.trend} positive={asset.changePercent >= 0} />
                    </td>
                    <td className="muted" data-label="Updated">{formatMarketTime(asset.lastUpdated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="detail-stack">
        {selectedAsset ? (
          <AssetDetail
            asset={selectedAsset}
            assets={allAssets}
            onSelect={onSelectAsset}
            onToggleWatch={onToggleWatch}
          />
        ) : (
          <section className="panel">
            <EmptyState title="Select an asset">
              Choose a symbol from the watchlist to view historical
              performance and surveillance parameters.
            </EmptyState>
          </section>
        )}
      </div>

      <AlertRail
        activeAlerts={activeAlerts}
        apiStatus={apiStatus}
        meta={meta}
        onOpenAlerts={onOpenAlerts}
        onMarkRead={onMarkRead}
      />
    </section>
  )
}

function AlertRail({
  activeAlerts,
  apiStatus,
  meta,
  onOpenAlerts,
  onMarkRead,
}: {
  activeAlerts: Alert[]
  apiStatus: ApiStatus
  meta: BackendMeta
  onOpenAlerts: () => void
  onMarkRead: (id: string) => void
}) {
  return (
    <aside className="panel alert-rail" aria-labelledby="active-alerts-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Surveillance Queue</p>
          <h2 id="active-alerts-title">Live Feed</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onOpenAlerts}>
          History
        </button>
      </div>

      <div className="queue-list">
        <div className="queue-health">
          <span>Surveillance Engine</span>
          <strong>{apiStatus === 'live' ? 'Feed Operational' : 'Feed Offline'}</strong>
          <small>{meta.source} gateway · {meta.cacheTtlSeconds}s resolution</small>
        </div>
        {activeAlerts.length === 0 ? (
          <EmptyState title="Clear queue">
            No threshold violations recorded in the current session.
          </EmptyState>
        ) : (
          activeAlerts.map((alert) => (
            <article className="queue-item" key={alert.id}>
              <div className="queue-item-top">
                <span className={alert.priority === 'high' ? 'badge high' : 'badge'}>
                  {alert.priority === 'high' ? 'High Risk' : 'Standard'}
                </span>
                <span className="number">{alert.ticker}</span>
              </div>
              <h3>{alert.message}</h3>
              <p>{formatVnd(alert.priceAtEvent)} · {formatMarketDate(alert.createdAt)}</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => onMarkRead(alert.id)}
              >
                Archive
              </button>
            </article>
          ))
        )}
      </div>
    </aside>
  )
}

function AlertCenter({
  alerts,
  activeFilter,
  onFilterChange,
  onMarkRead,
}: {
  alerts: Alert[]
  activeFilter: AlertFilter
  onFilterChange: (filter: AlertFilter) => void
  onMarkRead: (id: string) => void
}) {
  return (
    <section className="panel" aria-labelledby="alerts-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Notification Archive</p>
          <h2 id="alerts-title">Threshold Violations</h2>
        </div>
        <div className="segmented" aria-label="Alert filters">
          {(['all', 'high', 'standard'] as AlertFilter[]).map((filter) => (
            <button
              type="button"
              key={filter}
              aria-pressed={activeFilter === filter}
              onClick={() => onFilterChange(filter)}
            >
              {filter === 'all' ? 'All' : filter === 'high' ? 'High Risk' : 'Standard'}
            </button>
          ))}
        </div>
      </div>

      <div className="alert-list">
        {alerts.length === 0 ? (
          <EmptyState
            title="Archive is empty"
            actionLabel={activeFilter === 'all' ? undefined : 'Clear filters'}
            onAction={activeFilter === 'all' ? undefined : () => onFilterChange('all')}
          >
            Violation logs will appear here as the surveillance engine identifies
            price movement outside of configured bands.
          </EmptyState>
        ) : (
          alerts.map((alert) => (
            <article className="alert-item" key={alert.id}>
              <div>
                <div className="alert-title-line">
                  <span className={alert.priority === 'high' ? 'badge high' : 'badge'}>
                    {alert.priority === 'high' ? 'High Risk' : 'Standard'}
                  </span>
                  {!alert.read && <span className="unread-dot">New</span>}
                </div>
                <h3>{alert.ticker}: {alert.message}</h3>
                <p>
                  Trigger price {formatVnd(alert.priceAtEvent)} · {formatMarketDate(alert.createdAt)}
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={alert.read}
                onClick={() => onMarkRead(alert.id)}
              >
                {alert.read ? 'Archived' : 'Archive'}
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  )
}

function AssetDetail({
  asset,
  assets,
  onSelect,
  onToggleWatch,
}: {
  asset: Asset
  assets: Asset[]
  onSelect: (ticker: string) => void
  onToggleWatch: (ticker: string) => void
}) {
  const [finderQuery, setFinderQuery] = useState('')
  const finderAssets = useMemo(() => {
    const matches = filterAssets(assets, finderQuery).slice(0, 18)
    return matches.some((item) => item.ticker === asset.ticker)
      ? matches
      : [asset, ...matches]
  }, [asset, assets, finderQuery])

  return (
    <section className="detail-grid">
      <div className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Surveillance Detail</p>
            <h2>{asset.title}</h2>
          </div>
          <div className="asset-finder">
            <label className="search-field search-field-compact">
              <span className="sr-only">Switch symbol</span>
              <input
                type="search"
                value={finderQuery}
                placeholder="Find..."
                onChange={(event) => setFinderQuery(event.target.value)}
              />
            </label>
            <select
              className="select-input"
              value={asset.ticker}
              aria-label="Select asset"
              onChange={(event) => onSelect(event.target.value)}
            >
              {finderAssets.map((item) => (
                <option value={item.ticker} key={item.ticker}>
                  {item.ticker} · {item.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Suspense fallback={<ChartSkeleton />}>
          <AssetPriceChart asset={asset} />
        </Suspense>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Market Fundamentals</p>
            <h2>Asset Profile</h2>
          </div>
        </div>

        <dl className="fundamentals">
          <div>
            <dt>Market capitalization</dt>
            <dd>{asset.marketCap}</dd>
          </div>
          <div>
            <dt>P/E ratio</dt>
            <dd>{asset.peRatio ?? 'N/A'}</dd>
          </div>
          <div>
            <dt>Priority bracket</dt>
            <dd>{asset.rank ? `VN30 #${asset.rank}` : 'Standard Universe'}</dd>
          </div>
          <div>
            <dt>Last snapshot</dt>
            <dd>{formatMarketDate(asset.lastUpdated)}</dd>
          </div>
        </dl>

        <div className="watch-row">
          <div>
            <strong>Surveillance</strong>
            <span>{asset.watched ? 'Asset is under active monitoring.' : 'Monitoring is paused.'}</span>
          </div>
          <button
            type="button"
            className={asset.watched ? 'secondary-button' : 'primary-button'}
            onClick={() => onToggleWatch(asset.ticker)}
          >
            {asset.watched ? 'Pause' : 'Monitor'}
          </button>
        </div>
      </div>
    </section>
  )
}

function ChartSkeleton() {
  return (
    <div className="chart-surface" aria-label="Loading asset chart">
      <div className="chart-toolbar">
        <div className="chart-skeleton chart-skeleton-price" />
        <div className="chart-skeleton chart-skeleton-controls" />
      </div>
      <div className="chart-frame chart-frame-loading">
        <div className="chart-skeleton chart-skeleton-plot" />
      </div>
    </div>
  )
}

function SettingsPanel({
  settings,
  meta,
  apiStatus,
  onSave,
}: {
  settings: Settings
  meta: BackendMeta
  apiStatus: ApiStatus
  onSave: (settings: Settings) => void
}) {
  const [draft, setDraft] = useState(settings)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!saved) return

    const timeoutId = window.setTimeout(() => setSaved(false), 1800)
    return () => window.clearTimeout(timeoutId)
  }, [saved])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave(draft)
    setSaved(true)
  }

  return (
    <div className="settings-layout">
      <section className="panel settings-panel" aria-labelledby="settings-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Surveillance Config</p>
            <h2 id="settings-title">Alert Thresholds</h2>
          </div>
          {saved && <span className="status-pill status-live" role="status">Saved</span>}
        </div>

        <form className="settings-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Price deviation threshold</span>
            <div className="input-with-suffix">
              <input
                type="number"
                min="1"
                max="50"
                step="0.5"
                value={draft.thresholdPercent}
                onChange={(event) =>
                  setDraft({ ...draft, thresholdPercent: Number(event.target.value) })
                }
              />
              <span>%</span>
            </div>
          </label>

          <ToggleField
            label="Push notifications"
            description="Broadcast alerts via priority surveillance channels."
            checked={draft.emailEnabled}
            onChange={(emailEnabled) => setDraft({ ...draft, emailEnabled })}
          />

          <ToggleField
            label="Direct messaging"
            description="Instant routing for high-risk threshold breaks."
            checked={draft.smsEnabled}
            onChange={(smsEnabled) => setDraft({ ...draft, smsEnabled })}
          />

          <button type="submit" className="primary-button">Apply Changes</button>
        </form>
      </section>

      <section className="panel system-panel" aria-labelledby="system-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Infrastructure</p>
            <h2 id="system-title">Backend Pipeline</h2>
          </div>
        </div>
        <div className="system-content">
          <p className="system-description">
            The surveillance engine utilizes a serverless-ready architecture.
            Local Python handlers simulate AWS Lambda boundaries for seamless
            transition to production cloud deployment.
          </p>
          <div className="pipeline-steps">
            <PipelineStep label="Data Ingest" value={meta.source} />
            <PipelineStep label="Caching" value={`${meta.cacheTtlSeconds}s TTL`} />
            <PipelineStep label="Analysis" value={apiStatus === 'live' ? 'Active' : 'Offline'} />
            <PipelineStep label="Routing" value="SNS/SQS" />
          </div>
        </div>
      </section>
    </div>
  )
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="toggle-field">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

function PipelineStep({ label, value }: { label: string; value: string }) {
  return (
    <div className="pipeline-step">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const Sparkline = memo(function Sparkline({
  values,
  positive,
  large = false,
}: {
  values: number[]
  positive: boolean
  large?: boolean
}) {
  const points = useMemo(() => {
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100
        const y = 34 - ((value - min) / range) * 28
        return `${x},${y}`
      })
      .join(' ')
  }, [values])

  return (
    <svg
      className={large ? 'sparkline sparkline-large' : 'sparkline'}
      viewBox="0 0 100 40"
      role="img"
      aria-label={positive ? 'Upward trend' : 'Downward trend'}
      preserveAspectRatio="none"
    >
      <polyline className={positive ? 'spark-up' : 'spark-down'} points={points} />
    </svg>
  )
})

function viewTitle(view: View) {
  switch (view) {
    case 'dashboard':
      return 'Market Dashboard'
    case 'alerts':
      return 'Alert Center'
    case 'detail':
      return 'Asset Surveillance'
    case 'settings':
      return 'Infrastructure Settings'
  }
}

function filterAssets(assets: Asset[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return assets

  return assets.filter((asset) =>
    `${asset.ticker} ${asset.title}`.toLowerCase().includes(normalizedQuery),
  )
}

export default App
