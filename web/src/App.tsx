import { Check, Copy, Download, FileCode2, Github, Loader2, Play, RotateCcw } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { CodeEditor } from "@/components/CodeEditor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Toaster } from "@/components/ui/sonner"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  LUA_VERSIONS,
  PRESETS,
  type LuaVersion,
  type PresetName,
  type PrometheusLog,
  type PrometheusResult,
  type WorkerRequest,
  type WorkerResponse,
} from "@/lib/prometheusTypes"

const initialSource = `local message = "Hello, World!"
print(message)
`
const WORKER_TIMEOUT_MS = 90_000

function createSeed() {
  return Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646) + 1
}

function downloadLua(output: string) {
  const blob = new Blob([output], { type: "text/x-lua;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "prometheus.obfuscated.lua"
  link.click()
  URL.revokeObjectURL(url)
}

function formatWorkerError(event: ErrorEvent): string {
  const location =
    event.filename && event.lineno
      ? ` (${event.filename}:${event.lineno}:${event.colno})`
      : ""
  const detail =
    event.error instanceof Error
      ? `${event.error.name}: ${event.error.message}${event.error.stack ? `\n${event.error.stack}` : ""}`
      : event.message || "Worker crashed while processing the obfuscation request."
  return `${detail}${location}`
}

export default function App() {
  const [source, setSource] = useState(initialSource)
  const [output, setOutput] = useState("")
  const [preset, setPreset] = useState<PresetName>("Medium")
  const [luaVersion, setLuaVersion] = useState<LuaVersion>("Lua51")
  const [prettyPrint, setPrettyPrint] = useState(false)
  const [seed, setSeed] = useState(createSeed)
  const [logs, setLogs] = useState<PrometheusLog[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const workerUrlRef = useRef<string>("")

  function setupWorker(worker: Worker) {
    worker.addEventListener("error", (event: Event) => {
      const errorEvent = event as ErrorEvent
      const detail = formatWorkerError(errorEvent)
      console.error("Prometheus worker error event:", event)
      console.error("Prometheus worker detail:", detail)
      setIsRunning(false)
      setLogs((current) => [...current, { level: "error", message: detail }])
      toast.error("Worker error")
      workerRef.current?.terminate()
      workerRef.current = null
    })

    worker.addEventListener("messageerror", (event) => {
      console.error("Prometheus worker message error:", event)
      setIsRunning(false)
      setLogs((current) => [...current, { level: "error", message: "Worker message decode failed." }])
      toast.error("Worker message error")
      workerRef.current?.terminate()
      workerRef.current = null
    })
  }

  async function canLoadWorker(workerUrl: string): Promise<{ ok: boolean; message?: string }> {
    if (window.location.protocol === "file:") {
      return {
        ok: false,
        message:
          "Worker cannot run from file://. Serve the app over http:// or https:// (for example with `pnpm --filter web dev` or `pnpm --filter web preview`).",
      }
    }

    try {
      const response = await fetch(workerUrl, { method: "GET", cache: "no-store" })
      if (!response.ok) {
        return {
          ok: false,
          message: `Worker script request failed: ${response.status} ${response.statusText} (${workerUrl})`,
        }
      }
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        message: `Worker script request threw: ${error instanceof Error ? error.message : String(error)} (${workerUrl})`,
      }
    }
  }

  useEffect(() => {
    const workerUrl = new URL("./worker/prometheus.worker.ts", import.meta.url).toString()
    workerUrlRef.current = workerUrl
    const worker = new Worker(new URL("./worker/prometheus.worker.ts", import.meta.url), {
      type: "module",
    })
    workerRef.current = worker
    setupWorker(worker)

    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const canExport = output.trim().length > 0

  const status = useMemo(() => {
    if (isRunning) {
      return "Obfuscating"
    }
    if (logs.some((log) => log.level === "error")) {
      return "Error"
    }
    return output ? "Ready" : "Idle"
  }, [isRunning, logs, output])

  async function obfuscate() {
    let worker = workerRef.current
    const workerUrl =
      workerUrlRef.current || new URL("./worker/prometheus.worker.ts", import.meta.url).toString()
    const preflight = await canLoadWorker(workerUrl)
    if (!preflight.ok) {
      setIsRunning(false)
      setLogs([{ level: "error", message: preflight.message ?? "Worker preflight failed." }])
      toast.error("Worker load failed")
      return
    }

    if (!worker) {
      worker = new Worker(new URL("./worker/prometheus.worker.ts", import.meta.url), {
        type: "module",
      })
      setupWorker(worker)
      workerRef.current = worker
    }

    if (!worker || isRunning) {
      return
    }

    setIsRunning(true)
    setLogs([])
    const id = ++requestIdRef.current
    const request: WorkerRequest = {
      id,
      options: {
        source,
        filename: "browser-input.lua",
        preset,
        luaVersion,
        prettyPrint,
        seed,
      },
    }

    const result = await new Promise<WorkerResponse["result"]>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        worker.removeEventListener("message", listener)
        reject(new Error("Worker timed out before returning a result."))
      }, WORKER_TIMEOUT_MS)

      const listener = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id !== id) {
          return
        }
        window.clearTimeout(timeout)
        worker.removeEventListener("message", listener)
        resolve(event.data.result)
      }
      worker.addEventListener("message", listener)
      worker.postMessage(request)
    }).catch((error): PrometheusResult => {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        logs: [],
      }
    })

    setIsRunning(false)
    setLogs(result.logs)
    if (result.ok) {
      setOutput(result.output)
      setSeed(createSeed())
      toast.success("Obfuscation complete")
    } else {
      setOutput("")
      setLogs([...result.logs, { level: "error", message: result.error }])
      toast.error("Obfuscation failed")
    }
  }

  async function copyOutput() {
    if (!canExport) {
      return
    }
    await navigator.clipboard.writeText(output)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <TooltipProvider>
      <main className="flex min-h-screen flex-col">
        <header className="border-b bg-card">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <FileCode2 className="size-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-tight">Prometheus Web</h1>
                <p className="text-xs text-muted-foreground">
                  In-browser Lua obfuscation powered by Prometheus by levno-710.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-xs text-muted-foreground">If you like this tool, leave a star on</span>
              <a
                href="https://github.com/prometheus-lua/Prometheus"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                GitHub
                <Github className="size-3.5" />
              </a>
              <span className="rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">{status}</span>
              <Button onClick={obfuscate} disabled={isRunning} className="min-w-32">
                {isRunning ? <Loader2 className="animate-spin" /> : <Play />}
                Obfuscate
              </Button>
            </div>
          </div>
        </header>

        <section className="border-b bg-background">
          <div className="mx-auto grid w-full max-w-[1600px] gap-3 px-4 py-3 md:grid-cols-2 xl:grid-cols-[180px_160px_150px_210px_auto] xl:items-end">
            <div className="space-y-1.5">
              <Label>Preset</Label>
              <Select value={preset} onValueChange={(value) => setPreset(value as PresetName)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Lua Version</Label>
              <Select value={luaVersion} onValueChange={(value) => setLuaVersion(value as LuaVersion)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LUA_VERSIONS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex h-10 items-center gap-2 self-end rounded-md border bg-card px-3">
              <Switch checked={prettyPrint} onCheckedChange={setPrettyPrint} id="pretty-print" />
              <Label htmlFor="pretty-print" className="text-sm">
                Pretty print
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seed">Seed</Label>
              <div className="flex gap-2">
                <Input
                  id="seed"
                  type="number"
                  min={1}
                  value={seed}
                  onChange={(event) => setSeed(Math.max(1, Number(event.target.value) || 1))}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={() => setSeed(createSeed())} aria-label="Generate seed">
                      <RotateCcw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Generate seed</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="flex gap-2 self-end">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={copyOutput} disabled={!canExport} aria-label="Copy output">
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy output</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={() => downloadLua(output)} disabled={!canExport} aria-label="Download output">
                    <Download />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Download output</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </section>

        <section className="mx-auto grid min-h-[620px] w-full max-w-[1600px] flex-1 gap-3 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_340px]">
          <CodeEditor label="Lua input" value={source} onChange={setSource} />
          <CodeEditor label="Obfuscated output" value={output} readOnly />
          <aside className="flex min-h-[240px] flex-col rounded-md border bg-card">
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground">Logs</div>
            <Separator />
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2 p-3 text-xs">
                {logs.length === 0 ? (
                  <p className="text-muted-foreground">No logs yet.</p>
                ) : (
                  logs.map((log, index) => (
                    <div key={`${log.level}-${index}`} className="rounded-md border bg-background px-2 py-1.5">
                      <span className="font-medium uppercase text-muted-foreground">{log.level}</span>{" "}
                      <span className={log.level === "error" ? "text-destructive" : ""}>{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </aside>
        </section>
      </main>
      <Toaster />
    </TooltipProvider>
  )
}
