import type { WorkerRequest, WorkerResponse } from "@/lib/prometheusTypes"
type RunPrometheus = typeof import("./prometheusRunner")["runPrometheus"]

let runPrometheus: RunPrometheus | null = null

async function getRunPrometheus(): Promise<RunPrometheus> {
  if (runPrometheus) {
    return runPrometheus
  }

  const module = await import("./prometheusRunner")
  runPrometheus = module.runPrometheus
  return runPrometheus
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, options } = event.data
  const result = await getRunPrometheus()
    .then((execute) => execute(options))
    .catch((error) => ({
      ok: false as const,
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`
          : String(error),
      logs: [],
    }))

  const response: WorkerResponse = { id, result }
  self.postMessage(response)
}
