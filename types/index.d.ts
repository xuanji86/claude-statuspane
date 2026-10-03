/**
 * One progress row on the card, from a progress file or from another mod's
 * `$.statuspane.progress(...)` call.
 */
export type StatuspaneProgress = {
  /** Unique per source; a later report under the same id replaces the row. */
  id: string
  /** Short name shown before the bar (cut to 24 characters). */
  label: string
  /** 0–100; leave it out for a text-only row. */
  percent?: number
  /** Detail after the bar, e.g. "ch12/30 · 3.1/min" (cut to 60 characters). */
  text?: string
  /** Seconds the row stays without a fresh report (default 300). */
  ttl?: number
}

/** What other mods call: `$.statuspane.progress({...})`, `$.statuspane.clear(id)`. */
export type Statuspane = {
  progress: (item: StatuspaneProgress) => Promise<void>
  clear: (id: string) => Promise<void>
}

export type StatuspaneLimit = { pct: number; resetsAt?: string }

/** A progress row as the card draws it: sanitized, with its expiry. */
export type StatuspaneRow = { id: string; label: string; percent?: number; text?: string; expiresAt: number }

export type StatuspaneFigures = {
  dir: string | null
  branch: string | null
  model: string | null
  effort: string | null
  ctxPct?: number
  ctxTokens?: number
  ctxWindow?: number
  fiveHour?: StatuspaneLimit
  week?: StatuspaneLimit
  costUsd?: number
  progress: StatuspaneRow[]
}

export type StatuspanePrefs = {
  model: boolean
  ctx: boolean
  limits: boolean
  eta: boolean
  location: boolean
  cost: boolean
  progress: boolean
  barWidth: number
}

declare module 'claude-code' {
  interface EngineInterface {
    statuspane: Statuspane
  }
  interface PluginState {
    statuspane: {
      figures: StatuspaneFigures
      isHidden: boolean
      prefs: StatuspanePrefs
      isSettingsOpen: boolean
    }
  }
}
