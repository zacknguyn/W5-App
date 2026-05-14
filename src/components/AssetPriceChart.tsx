import { useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { compactVnd, formatVnd } from '../lib/format'
import type { Asset, ChartPoint } from '../types'

const rangeSize = {
  '1D': 8,
  '1W': 20,
  '1M': 60,
} as const

export function AssetPriceChart({ asset }: { asset: Asset }) {
  const [range, setRange] = useState<'1D' | '1W' | '1M'>('1D')
  const [showThreshold, setShowThreshold] = useState(true)
  const [showAlerts, setShowAlerts] = useState(true)
  const chartData = asset.chart.slice(-rangeSize[range])
  const latestPoint = chartData.at(-1)
  const alertPoints = chartData.filter((point) => point.alert)

  return (
    <div className="chart-surface">
      <div className="chart-toolbar">
        <div className="detail-price">
          <span>{asset.ticker}</span>
          <strong>{formatVnd(asset.price)}</strong>
          <em className={asset.changePercent >= 0 ? 'up' : 'down'}>
            {asset.changePercent >= 0 ? '+' : ''}
            {asset.changePercent.toFixed(2)}% phiên
          </em>
        </div>

        <div className="chart-controls" aria-label="Chart controls">
          <div className="segmented" aria-label="Chart range">
            {(['1D', '1W', '1M'] as const).map((option) => (
              <button
                type="button"
                key={option}
                aria-pressed={range === option}
                onClick={() => setRange(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={showThreshold}
              onChange={(event) => setShowThreshold(event.target.checked)}
            />
            Threshold
          </label>
          <label>
            <input
              type="checkbox"
              checked={showAlerts}
              onChange={(event) => setShowAlerts(event.target.checked)}
            />
            Alerts
          </label>
        </div>
      </div>

      <div
        className="chart-frame"
        role="img"
        aria-label={`${asset.ticker} price chart for ${range}, latest price ${formatVnd(asset.price)}`}
      >
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 18, right: 18, bottom: 8, left: 2 }}>
            <CartesianGrid stroke="var(--hairline-soft)" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--body)', fontSize: 13 }}
              minTickGap={18}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              tickFormatter={(value) => compactVnd(Number(value))}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--body)', fontSize: 13 }}
              domain={['dataMin - dataMin * 0.01', 'dataMax + dataMax * 0.01']}
            />
            <YAxis yAxisId="volume" hide domain={[0, 'dataMax + 20']} />
            <Tooltip
              cursor={{ stroke: 'var(--hairline)', strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const price = payload.find((item) => item.dataKey === 'price')?.value
                const volume = payload.find((item) => item.dataKey === 'volume')?.value

                return (
                  <div className="chart-tooltip">
                    <strong>{label}</strong>
                    <span>Giá {formatVnd(Number(price))}</span>
                    <span>Volume {Number(volume).toFixed(0)}</span>
                  </div>
                )
              }}
            />
            <Bar
              yAxisId="volume"
              dataKey="volume"
              barSize={16}
              radius={[6, 6, 0, 0]}
              fill="var(--volume-bar)"
            />
            <Area
              yAxisId="price"
              type="monotone"
              dataKey="price"
              stroke="none"
              fill="var(--price-area)"
              fillOpacity={1}
            />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="price"
              dot={false}
              stroke={asset.changePercent >= 0 ? 'var(--semantic-up)' : 'var(--semantic-down)'}
              strokeWidth={3.5}
              activeDot={{ r: 5, strokeWidth: 0 }}
            />
            {showThreshold && latestPoint && (
              <>
                <ReferenceLine
                  yAxisId="price"
                  y={latestPoint.thresholdHigh}
                  stroke="var(--action-blue)"
                  strokeDasharray="6 6"
                  strokeWidth={1.5}
                />
                <ReferenceLine
                  yAxisId="price"
                  y={latestPoint.thresholdLow}
                  stroke="var(--action-blue)"
                  strokeDasharray="6 6"
                  strokeOpacity={0.45}
                />
              </>
            )}
            {showAlerts && alertPoints.map((point) => (
              <ReferenceDot
                key={`${point.label}-${point.price}`}
                yAxisId="price"
                x={point.label}
                y={point.price}
                r={6}
                fill="var(--coral)"
                stroke="var(--canvas)"
                strokeWidth={3}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ChartDataTable data={chartData} asset={asset} />
    </div>
  )
}

function ChartDataTable({ data, asset }: { data: ChartPoint[]; asset: Asset }) {
  return (
    <table className="sr-only">
      <caption>{asset.ticker} accessible price data</caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Price</th>
          <th scope="col">Threshold high</th>
          <th scope="col">Threshold low</th>
          <th scope="col">Volume</th>
          <th scope="col">Alert priority</th>
        </tr>
      </thead>
      <tbody>
        {data.map((point) => (
          <tr key={`${point.label}-${point.price}-${point.volume}`}>
            <td>{point.label}</td>
            <td>{formatVnd(point.price)}</td>
            <td>{formatVnd(point.thresholdHigh)}</td>
            <td>{formatVnd(point.thresholdLow)}</td>
            <td>{point.volume}</td>
            <td>{point.alert ?? 'None'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
