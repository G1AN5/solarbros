import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'

import { AuthProvider } from '@/app/auth/AuthProvider'
import { router } from '@/app/router'

/* ============================================================================
   App — composition root.
   ----------------------------------------------------------------------------
   Provider order matters (outermost first):
     QueryClientProvider → server-state cache, must wrap anything that fetches
     AuthProvider        → who is signed in; route guards depend on it
     RouterProvider      → the page tree

   Nothing else belongs in this file. Page logic lives in src/features/.
   ========================================================================== */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Operational data (stock levels, dispatch board) goes stale quickly, but
      // refetching on every window focus is noisy for staff who alt-tab a lot.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  )
}
