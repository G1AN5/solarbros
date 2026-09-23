import { useContext } from 'react'
import { AuthContext, type AuthState } from './AuthContext'

/** Read the current user and role. Throws if used outside <AuthProvider>. */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
