import type {
  CoachingSummary,
  MissList,
  Progress,
  RunDetail,
  Streak,
  RunSummary,
  SaveSessionRequest,
  SaveSessionResponse,
} from '@dojc/core'

export async function saveSession(request: SaveSessionRequest): Promise<SaveSessionResponse> {
  const response = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    keepalive: true,
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<SaveSessionResponse>
}

export async function fetchCoaching(layoutId: string): Promise<CoachingSummary | null> {
  const response = await fetch(`/api/coaching?layoutId=${encodeURIComponent(layoutId)}`)
  if (!response.ok) return null
  return response.json() as Promise<CoachingSummary>
}

export async function fetchStreak(): Promise<Streak | null> {
  const response = await fetch('/api/streak')
  if (!response.ok) return null
  return response.json() as Promise<Streak>
}

export async function fetchProgress(layoutId: string): Promise<Progress | null> {
  const response = await fetch(`/api/progress?layoutId=${encodeURIComponent(layoutId)}`)
  if (!response.ok) return null
  return response.json() as Promise<Progress>
}

export async function fetchRuns(layoutId: string): Promise<RunSummary[]> {
  const response = await fetch(`/api/runs?layoutId=${encodeURIComponent(layoutId)}`)
  if (!response.ok) return []
  return response.json() as Promise<RunSummary[]>
}

export async function fetchRun(id: string): Promise<RunDetail | null> {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}`)
  if (!response.ok) return null
  return response.json() as Promise<RunDetail>
}

export async function fetchMisses(layoutId: string): Promise<MissList | null> {
  const response = await fetch(`/api/misses?layoutId=${encodeURIComponent(layoutId)}`)
  if (!response.ok) return null
  return response.json() as Promise<MissList>
}
