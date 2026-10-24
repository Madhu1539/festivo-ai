import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Holds the plan currently being worked on so it survives navigation between
 * /create and /plan, plus a page refresh. This is browser-session state only —
 * it is deliberately not presented as cloud storage (§7.6).
 */

const STORAGE_KEY = 'festivo.draft.v1'

const PlanContext = createContext(null)

function readStoredDraft() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.input && parsed?.plan) return parsed
    return null
  } catch {
    return null
  }
}

export function PlanProvider({ children }) {
  const [draft, setDraftState] = useState(readStoredDraft)
  // Remembers the last submitted form values so a failed generation does not
  // lose the user's input (§7.4, §18.4).
  const [lastInput, setLastInput] = useState(() => readStoredDraft()?.input ?? null)

  useEffect(() => {
    try {
      if (draft) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* Storage may be unavailable (private mode); in-memory state still works. */
    }
  }, [draft])

  const setDraft = useCallback((input, plan) => {
    setDraftState({ input, plan, savedId: null })
    setLastInput(input)
  }, [])

  const rememberInput = useCallback((input) => setLastInput(input), [])

  const clearDraft = useCallback(() => setDraftState(null), [])

  /** Local-only plan mutation, e.g. ticking a checklist item (§11.3). */
  const updatePlan = useCallback((updater) => {
    setDraftState((current) => {
      if (!current) return current
      const nextPlan = updater(current.plan)
      return nextPlan === current.plan ? current : { ...current, plan: nextPlan }
    })
  }, [])

  const markSaved = useCallback((savedId) => {
    setDraftState((current) => (current ? { ...current, savedId } : current))
  }, [])

  const value = useMemo(
    () => ({ draft, lastInput, setDraft, clearDraft, updatePlan, markSaved, rememberInput }),
    [draft, lastInput, setDraft, clearDraft, updatePlan, markSaved, rememberInput],
  )

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>
}

export function usePlan() {
  const context = useContext(PlanContext)
  if (!context) throw new Error('usePlan must be used inside a PlanProvider')
  return context
}

/** Recomputes checklist progress locally (§11.4 — safe when empty). */
export function withChecklistItem(plan, itemId, isCompleted) {
  const vendor_checklist = plan.vendor_checklist.map((item) =>
    item.id === itemId ? { ...item, is_completed: isCompleted } : item,
  )
  const total = vendor_checklist.length
  const completed = vendor_checklist.filter((item) => item.is_completed).length

  return {
    ...plan,
    vendor_checklist,
    checklist_progress: {
      total,
      completed,
      percent: total ? Math.round((completed / total) * 1000) / 10 : 0,
    },
  }
}

export function withTimelineItem(plan, itemId, isCompleted) {
  return {
    ...plan,
    timeline: plan.timeline.map((item) =>
      item.id === itemId ? { ...item, is_completed: isCompleted } : item,
    ),
  }
}
