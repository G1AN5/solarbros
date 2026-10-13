import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
// The heading face, bundled with the app rather than fetched from a font CDN:
// no third-party request, and the field app keeps it offline. Only the Latin
// subset is downloaded on these pages (the file declares unicode ranges).
import '@fontsource-variable/plus-jakarta-sans'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
