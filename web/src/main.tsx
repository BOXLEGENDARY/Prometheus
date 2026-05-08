import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App"
import "./index.css"

const docsPath = `${import.meta.env.BASE_URL}docs`
const normalizePath = (value: string) => value.replace(/\/+$/, "") || "/"
const currentPath = normalizePath(window.location.pathname)
const normalizedDocsPath = normalizePath(docsPath)

if (currentPath === normalizedDocsPath) {
  window.location.replace(`${normalizedDocsPath}/index.html${window.location.search}${window.location.hash}`)
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
