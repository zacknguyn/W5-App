import type { Alert, Asset, BackendMeta, Settings } from '../types'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api'

export const hasApiBaseUrl = Boolean(apiBaseUrl)

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
  })

  const text = await response.text()

  if (!response.ok) {
    const fallbackMessage = `API request failed with ${response.status}`

    try {
      const error = JSON.parse(text) as { message?: string }
      throw new Error(error.message ?? fallbackMessage)
    } catch (jsonError) {
      if (jsonError instanceof Error && jsonError.message !== fallbackMessage) {
        throw jsonError
      }

      throw new Error(fallbackMessage, { cause: jsonError })
    }
  }

  if (!text.trim()) {
    throw new Error(`Empty API response from ${path}`)
  }

  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Invalid JSON from ${path}: ${error.message}`
        : `Invalid JSON from ${path}`,
      { cause: error },
    )
  }
}

export async function fetchAssets(signal?: AbortSignal): Promise<Asset[]> {
  return requestJson<Asset[]>('/assets', { signal })
}

export async function fetchMeta(signal?: AbortSignal): Promise<BackendMeta> {
  return requestJson<BackendMeta>('/meta', { signal })
}

export async function fetchAlerts(signal?: AbortSignal): Promise<Alert[]> {
  return requestJson<Alert[]>('/alerts', { signal })
}

export async function fetchSettings(signal?: AbortSignal): Promise<Settings> {
  return requestJson<Settings>('/settings', { signal })
}

export async function updateAssetWatch(ticker: string, watched: boolean): Promise<Asset> {
  return requestJson<Asset>(`/assets/${encodeURIComponent(ticker)}/watch`, {
    method: 'PUT',
    body: JSON.stringify({ watched }),
  })
}

export async function markAlertRead(id: string): Promise<Alert> {
  return requestJson<Alert>(`/alerts/${encodeURIComponent(id)}/read`, {
    method: 'PUT',
  })
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  return requestJson<Settings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}
