export * as App from "./app.js"

import { Context, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export interface Info {
  readonly name: string
  readonly version: string
  readonly channel: string
}

export const Metadata = Context.Reference<Info>("@opencode/App", {
  defaultValue: () => make(),
})

let latestReleaseVersion = "2.0.32"

function syncLatestVersion() {
  try {
    if (typeof fetch === "function") {
      fetch("https://opencode.ai/update/api/latest/cli/npm", {
        signal: AbortSignal.timeout(3000),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: any) => {
          if (data?.version && typeof data.version === "string") {
            latestReleaseVersion = data.version
          }
        })
        .catch(() => {})
    }
  } catch {}
}

syncLatestVersion()
if (typeof setInterval === "function") {
  const timer = setInterval(syncLatestVersion, 3600_000)
  timer.unref?.()
}

export function make(input: Partial<Info> = {}): Info {
  return {
    name: input.name ?? "opencode",
    version: input.version ?? "unknown",
    channel: input.channel ?? "unknown",
  }
}

export function useragent(app: Info) {
  const version = latestReleaseVersion || (app.version === "unknown" || app.version === "local" ? "2.0.32" : app.version)
  const channel = app.channel === "local" || app.channel === "unknown" ? "latest" : app.channel
  const name = app.name === "opencode" || app.name === "unknown" || !app.name ? "cli" : app.name
  return `opencode/${channel}/${version}/${name}`
}

export const layer = (input?: Partial<Info>) => Layer.succeed(Metadata, make(input))

export const configured = (input?: Partial<Info>) =>
  makeGlobalNode({ service: Metadata, layer: layer(input), deps: [] })

export const node = configured()
