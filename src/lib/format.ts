export function formatVnd(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value)
}

export function compactVnd(value: number) {
  const absoluteValue = Math.abs(value)

  if (absoluteValue >= 1_000_000_000) {
    return `${formatCompact(value / 1_000_000_000)} tỷ ₫`
  }

  if (absoluteValue >= 1_000_000) {
    return `${formatCompact(value / 1_000_000)} tr ₫`
  }

  if (absoluteValue >= 1_000) {
    return `${formatCompact(value / 1_000)} nghìn ₫`
  }

  return formatVnd(value)
}

export function formatMarketDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatMarketTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  }).format(value)
}
