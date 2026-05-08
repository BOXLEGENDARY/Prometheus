import { Check, Copy, Download, FileCode2, Github, Loader2, Play, RotateCcw, Square } from "lucide-react"
import { useEffect, useRef, useState } from "react"
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

type ActiveJob = "idle" | "obfuscate" | "run-input" | "run-output"

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
      : event.message || "Worker crashed while processing the request."
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
  const [activeJob, setActiveJob] = useState<ActiveJob>("idle")
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
      setActiveJob("idle")
      setLogs((current) => [...current, { level: "error", message: detail }])
      toast.error("Worker error")
      workerRef.current?.terminate()
      workerRef.current = null
    })

    worker.addEventListener("messageerror", (event) => {
      console.error("Prometheus worker message error:", event)
      setActiveJob("idle")
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

  function createWorker() {
    const worker = new Worker(new URL("./worker/prometheus.worker.ts", import.meta.url), {
      type: "module",
    })
    workerRef.current = worker
    setupWorker(worker)
    return worker
  }

  function stopCurrentJob() {
    if (activeJob === "idle") {
      return
    }

    workerRef.current?.terminate()
    workerRef.current = null
    createWorker()
    setActiveJob("idle")
    setLogs((current) => [...current, { level: "warn", message: "Execution stopped by user." }])
    toast("Execution stopped")
  }

  useEffect(() => {
    const workerUrl = new URL("./worker/prometheus.worker.ts", import.meta.url).toString()
    workerUrlRef.current = workerUrl
    createWorker()

    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const canExport = output.trim().length > 0
  const isBusy = activeJob !== "idle"
  const isObfuscating = activeJob === "obfuscate"
  const isRunningInput = activeJob === "run-input"
  const isRunningOutput = activeJob === "run-output"

  async function sendWorkerRequest(request: WorkerRequest): Promise<PrometheusResult> {
    let worker = workerRef.current
    const workerUrl =
      workerUrlRef.current || new URL("./worker/prometheus.worker.ts", import.meta.url).toString()
    const preflight = await canLoadWorker(workerUrl)
    if (!preflight.ok) {
      setActiveJob("idle")
      return {
        ok: false,
        error: preflight.message ?? "Worker preflight failed.",
        logs: [],
      }
    }

    if (!worker) {
      worker = createWorker()
    }

    return new Promise<PrometheusResult>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        worker?.removeEventListener("message", listener)
        reject(new Error("Worker timed out before returning a result."))
      }, WORKER_TIMEOUT_MS)

      const listener = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data
        if (response.id !== request.id) {
          return
        }
        if (response.type === "log") {
          setLogs((current) => [...current, response.log])
          return
        }
        if (response.type !== "result") {
          return
        }
        window.clearTimeout(timeout)
        worker?.removeEventListener("message", listener)
        resolve(response.result)
      }
      worker?.addEventListener("message", listener)
      worker?.postMessage(request)
    }).catch((error): PrometheusResult => {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        logs: [],
      }
    })
  }

  async function obfuscate() {
    if (isBusy) {
      return
    }

    setActiveJob("obfuscate")
    setLogs([])
    const id = ++requestIdRef.current
    const request: WorkerRequest = {
      id,
      action: "obfuscate",
      options: {
        source,
        filename: "browser-input.lua",
        preset,
        luaVersion,
        prettyPrint,
        seed,
      },
    }

    const result = await sendWorkerRequest(request)
    setActiveJob("idle")
    setLogs(result.logs)

    if (result.ok) {
      setOutput(result.output)
      setSeed(createSeed())
      toast.success("Obfuscation complete")
      return
    }

    setOutput("")
    setLogs([...result.logs, { level: "error", message: result.error }])
    toast.error("Obfuscation failed")
  }

  async function runScript(kind: "input" | "output") {
    if (isBusy) {
      return
    }

    const script = kind === "input" ? source : output
    if (!script.trim()) {
      setLogs([{ level: "warn", message: `No ${kind} script to run.` }])
      return
    }

    setActiveJob(kind === "input" ? "run-input" : "run-output")
    setLogs([])
    const id = ++requestIdRef.current
    const request: WorkerRequest = {
      id,
      action: "runScript",
      source: script,
      filename: kind === "input" ? "browser-input.lua" : "browser-output.lua",
    }

    const result = await sendWorkerRequest(request)
    setActiveJob("idle")

    if (result.ok) {
      setLogs((current) => {
        if (current.length > 0) {
          return current
        }
        if (result.logs.length > 0) {
          return result.logs
        }
        return [{ level: "info", message: "Script finished without output." }]
      })
      toast.success("Script execution complete")
      return
    }

    setLogs([...result.logs, { level: "error", message: result.error }])
    toast.error("Script execution failed")
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
      <main className="flex h-screen min-h-0 flex-col overflow-hidden">
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
              <Button onClick={isObfuscating ? stopCurrentJob : obfuscate} disabled={isBusy && !isObfuscating} className="min-w-32">
                {isObfuscating ? <Loader2 className="animate-spin" /> : <Play />}
                {isObfuscating ? "Stop" : "Obfuscate"}
              </Button>
            </div>
          </div>
        </header>

        <section className="border-b bg-background">
          <div className="mx-auto grid w-full max-w-[1600px] gap-3 px-4 py-3 md:grid-cols-2 xl:grid-cols-[180px_160px_150px_210px_auto] xl:items-end">
            <div className="space-y-1.5">
              <Label>Preset</Label>
              <Select value={preset} onValueChange={(value) => setPreset(value as PresetName)}>
                <SelectTrigger disabled={isBusy}>
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
                <SelectTrigger disabled={isBusy}>
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
              <Switch checked={prettyPrint} onCheckedChange={setPrettyPrint} id="pretty-print" disabled={isBusy} />
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
                  disabled={isBusy}
                  onChange={(event) => setSeed(Math.max(1, Number(event.target.value) || 1))}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={() => setSeed(createSeed())} disabled={isBusy} aria-label="Generate seed">
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

        <section className="mx-auto grid min-h-0 w-full max-w-[1600px] flex-1 gap-3 overflow-hidden px-4 py-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_340px]">
          <CodeEditor
            label="Lua input"
            value={source}
            onChange={setSource}
            className="max-h-[560px] xl:max-h-none"
            actionButton={{
              label: isRunningInput ? "Stop" : "Run",
              icon: isRunningInput ? <Square /> : <Play />,
              onClick: isRunningInput ? stopCurrentJob : () => runScript("input"),
              disabled: isBusy && !isRunningInput,
            }}
          />
          <CodeEditor
            label="Obfuscated output"
            value={output}
            readOnly
            className="max-h-[560px] xl:max-h-none"
            actionButton={{
              label: isRunningOutput ? "Stop" : "Run",
              icon: isRunningOutput ? <Square /> : <Play />,
              onClick: isRunningOutput ? stopCurrentJob : () => runScript("output"),
              disabled: isBusy && !isRunningOutput,
            }}
          />
          <aside className="flex min-h-0 min-w-0 max-h-[280px] flex-col overflow-hidden rounded-md border bg-card xl:max-h-none">
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
