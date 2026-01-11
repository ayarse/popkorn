import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initParser } from './parser'

// Initialize tree-sitter parser before rendering
initParser().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}).catch((err) => {
  console.error('Failed to initialize parser:', err)
  document.getElementById('root')!.innerHTML = `
    <div style="color: red; padding: 20px;">
      Failed to initialize parser: ${err.message}
    </div>
  `
})
