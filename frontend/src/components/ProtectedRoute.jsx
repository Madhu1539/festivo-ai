/** Gate for screens that read or write saved data. */

import { Navigate, useLocation } from 'react-router-dom'

import LoadingState from './LoadingState'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isRestoring } = useAuth()
  const location = useLocation()

  // While a stored token is being checked, render neither the screen nor a
  // redirect: bouncing to the sign-in page and back is disorienting, and
  // announcing "sign in" to someone who is already signed in is wrong.
  if (isRestoring) {
    return (
      <LoadingState
        title="Checking your session…"
        message="One moment while we confirm you are signed in."
        steps={[]}
      />
    )
  }

  if (!isAuthenticated) {
    // `from` is carried so sign-in can return the user where they were going,
    // and `replace` keeps the protected URL out of history - otherwise Back
    // lands on it again and bounces straight back here.
    return (
      <Navigate to="/login" replace state={{ from: location.pathname }} />
    )
  }

  return children
}
