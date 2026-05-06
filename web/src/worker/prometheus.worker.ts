import type { WorkerRequest, WorkerResponse } from "@/lib/prometheusTypes"
import { runPrometheus } from "./prometheusRunner"

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, options } = event.data
  const result = await runPrometheus(options).catch((error) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
    logs: [],
  }))
  const response: WorkerResponse = { id, result }
  self.postMessage(response)
}
