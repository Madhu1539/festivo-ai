/**
 * Who is signed in, for the whole app.
 *
 * The token lives in localStorage (see eventApi) so a reload keeps you signed
 * in. On startup we ask the server who the token belongs to rather than
 * trusting anything cached: the session may have been revoked or expired
 * since, and the UI must not show a signed-in shell that every request then
 * rejects.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { authToken, eventApi, setUnauthorizedHandler } from '../services/eventApi'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // Starts true only when there is a token worth checking, so a visitor with
  // no session sees the app immediately instead of a spinner.
  const [isRestoring, setIsRestoring] = useState(() => Boolean(authToken.get()))

  // Any request that comes back 401 clears the session; reflect that here so
  // the navbar and protected routes update without a reload.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    return () => setUnauthorizedHandler(null)
  }, [])

  useEffect(() => {
    if (!authToken.get()) return

    const controller = new AbortController()
    let active = true

    eventApi
      .me({ signal: controller.signal })
      .then((me) => {
        if (active) setUser(me)
      })
      .catch(() => {
        // An invalid token is already cleared by the request layer. Anything
        // else (server down) also leaves us signed out, which is honest.
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setIsRestoring(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const adopt = useCallback((result) => {
    authToken.set(result.token)
    setUser(result.user)
    return result.user
  }, [])

  const login = useCallback(
    async (email, password) => adopt(await eventApi.login(email, password)),
    [adopt],
  )

  const register = useCallback(
    async (email, password) => adopt(await eventApi.register(email, password)),
    [adopt],
  )

  const logout = useCallback(async () => {
    try {
      // Tell the server first so the session row is actually revoked.
      await eventApi.logout()
    } catch {
      // Already invalid, or the server is unreachable. Either way the local
      // session must still end, so this is not surfaced as an error.
    } finally {
      authToken.clear()
      setUser(null)
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isRestoring,
      login,
      register,
      logout,
    }),
    [user, isRestoring, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }
  return context
}
