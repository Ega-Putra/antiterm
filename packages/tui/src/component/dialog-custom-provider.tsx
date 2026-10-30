import { createSignal, Show } from "solid-js"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { modify, applyEdits, parse } from "jsonc-parser"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { useConfig } from "../config"

export interface DialogCustomProviderProps {
  onConnected?: (providerID?: string) => void
  onBack?: () => void
}

export interface CustomProviderInfo {
  id: string
  name: string
  baseURL: string
  apiKey?: string
  models: string[]
}

export function getOpenCodeConfigPath(): string {
  const dir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode")
  const jsonc = path.join(dir, "opencode.jsonc")
  const json = path.join(dir, "opencode.json")
  if (fs.existsSync(jsonc)) return jsonc
  if (fs.existsSync(json)) return json
  return jsonc
}

export function getCustomProviders(): CustomProviderInfo[] {
  const configPath = getOpenCodeConfigPath()
  if (!fs.existsSync(configPath)) return []

  try {
    const text = fs.readFileSync(configPath, "utf8")
    const parsed = parse(text, [], { allowTrailingComma: true })
    if (!parsed || typeof parsed !== "object" || !parsed.provider) return []

    const authPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json")
    let authData: Record<string, any> = {}
    if (fs.existsSync(authPath)) {
      try {
        authData = JSON.parse(fs.readFileSync(authPath, "utf8"))
      } catch {}
    }

    const result: CustomProviderInfo[] = []
    for (const [id, val] of Object.entries(parsed.provider as Record<string, any>)) {
      if (!val || typeof val !== "object") continue
      const baseURL = val.options?.baseURL || ""
      const isCustom = Boolean(baseURL || val.npm === "@ai-sdk/openai-compatible")
      if (!isCustom) continue

      const name = (typeof val.name === "string" && val.name.trim()) ? val.name.trim() : id
      const apiKey =
        typeof val.options?.apiKey === "string"
          ? val.options.apiKey
          : typeof authData[id]?.key === "string"
            ? authData[id].key
            : undefined
      const models = val.models && typeof val.models === "object" ? Object.keys(val.models) : []

      result.push({
        id,
        name,
        baseURL,
        apiKey,
        models,
      })
    }
    return result
  } catch {
    return []
  }
}

export function deleteCustomProvider(providerID: string): void {
  const configPath = getOpenCodeConfigPath()

  if (fs.existsSync(configPath)) {
    try {
      const text = fs.readFileSync(configPath, "utf8")
      const edits = modify(text, ["provider", providerID], undefined, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      })
      fs.writeFileSync(configPath, applyEdits(text, edits), "utf8")
    } catch {}
  }

  const dataDir = path.join(os.homedir(), ".local", "share", "opencode")
  const authPath = path.join(dataDir, "auth.json")
  if (fs.existsSync(authPath)) {
    try {
      const authData = JSON.parse(fs.readFileSync(authPath, "utf8"))
      if (providerID in authData) {
        delete authData[providerID]
        fs.writeFileSync(authPath, JSON.stringify(authData, null, 2), "utf8")
      }
    } catch {}
  }
}

export async function refreshCustomProviderModels(providerID: string): Promise<string[]> {
  const providers = getCustomProviders()
  const provider = providers.find((p) => p.id === providerID)
  if (!provider) {
    throw new Error(`Provider "${providerID}" not found in configuration`)
  }
  if (!provider.baseURL) {
    throw new Error(`Provider "${providerID}" does not have a baseURL configured`)
  }

  const fetched = await fetchOpenAIModels(provider.baseURL, provider.apiKey)
  saveCustomProvider({
    providerID: provider.id,
    name: provider.name,
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    models: fetched,
  })
  return fetched
}

export async function refreshAllCustomProviderModels(): Promise<{ total: number; updated: number; errors: string[] }> {
  const providers = getCustomProviders()
  let updated = 0
  const errors: string[] = []

  for (const provider of providers) {
    if (!provider.baseURL) continue
    try {
      const fetched = await fetchOpenAIModels(provider.baseURL, provider.apiKey)
      saveCustomProvider({
        providerID: provider.id,
        name: provider.name,
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
        models: fetched,
      })
      updated++
    } catch (e: any) {
      errors.push(`${provider.name}: ${e?.message ?? e}`)
    }
  }

  return { total: providers.length, updated, errors }
}

export async function fetchOpenAIModels(baseURL: string, apiKey?: string): Promise<string[]> {
  const cleanUrl = baseURL.trim().replace(/\/+$/, "")
  const candidates = [
    `${cleanUrl}/models`,
    cleanUrl.endsWith("/v1") ? null : `${cleanUrl}/v1/models`,
    cleanUrl.replace(/\/v1$/, "") + "/models",
  ].filter((u): u is string => !!u)

  const headers: Record<string, string> = {
    Accept: "application/json",
  }
  if (apiKey?.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`
  }

  let lastError = ""
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${res.statusText}`
        continue
      }
      const data = await res.json()
      let list: string[] = []
      if (Array.isArray(data.data)) {
        list = data.data.map((m: any) => (typeof m === "string" ? m : m.id)).filter(Boolean)
      } else if (Array.isArray(data)) {
        list = data.map((m: any) => (typeof m === "string" ? m : m.id || m.name)).filter(Boolean)
      } else if (Array.isArray(data.models)) {
        list = data.models.map((m: any) => (typeof m === "string" ? m : m.id || m.name)).filter(Boolean)
      }
      if (list.length > 0) {
        return list
      }
    } catch (e: any) {
      lastError = e?.message ?? String(e)
    }
  }

  throw new Error(lastError || "No models returned from endpoint")
}

export function saveCustomProvider(params: {
  providerID: string
  name: string
  baseURL: string
  apiKey?: string
  models: string[]
}) {
  const configPath = getOpenCodeConfigPath()
  const dir = path.dirname(configPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  let text = "{}"
  if (fs.existsSync(configPath)) {
    try {
      text = fs.readFileSync(configPath, "utf8")
    } catch {}
  }

  const providerConfig = {
    name: params.name,
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: params.baseURL,
      ...(params.apiKey ? { apiKey: params.apiKey } : {}),
    },
    models: Object.fromEntries(params.models.map((m) => [m, { name: m }])),
  }

  const edits = modify(text, ["provider", params.providerID], providerConfig, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  fs.writeFileSync(configPath, applyEdits(text, edits), "utf8")

  if (params.apiKey) {
    const dataDir = path.join(os.homedir(), ".local", "share", "opencode")
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    const authPath = path.join(dataDir, "auth.json")
    let authData: Record<string, unknown> = {}
    if (fs.existsSync(authPath)) {
      try {
        authData = JSON.parse(fs.readFileSync(authPath, "utf8"))
      } catch {}
    }
    authData[params.providerID] = {
      type: "api",
      key: params.apiKey,
    }
    fs.writeFileSync(authPath, JSON.stringify(authData, null, 2), "utf8")
  }
}

export function DialogCustomProvider(props: DialogCustomProviderProps) {
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const config = useConfig()

  const [step, setStep] = createSignal<"url" | "key" | "name" | "fetching" | "confirm" | "manual">("url")
  const [url, setUrl] = createSignal("")
  const [apiKey, setApiKey] = createSignal("")
  const [name, setName] = createSignal("")
  const [models, setModels] = createSignal<string[]>([])
  const [fetchError, setFetchError] = createSignal("")
  const [urlError, setUrlError] = createSignal("")

  const deriveDefaultName = (targetUrl: string) => {
    try {
      const parsed = new URL(targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`)
      const host = parsed.hostname.replace(/^(api|openai)\./, "").split(".")[0]
      return host || "custom-ai"
    } catch {
      return "custom-ai"
    }
  }

  const startFetching = async (targetUrl: string, key: string, providerName: string) => {
    setStep("fetching")
    try {
      const fetched = await fetchOpenAIModels(targetUrl, key)
      setModels(fetched)
      setStep("confirm")
    } catch (e: any) {
      setFetchError(e?.message ?? "Failed to fetch models from endpoint")
      setStep("manual")
    }
  }

  const handleSaveAndConnect = async (finalModels: string[]) => {
    const providerID = (name().trim() || deriveDefaultName(url())).toLowerCase().replace(/[^a-z0-9_-]/g, "-")
    const providerName = name().trim() || providerID
    const targetUrl = url().trim().replace(/\/+$/, "")
    const key = apiKey().trim()

    try {
      saveCustomProvider({
        providerID,
        name: providerName,
        baseURL: targetUrl,
        apiKey: key || undefined,
        models: finalModels,
      })

      void config
        .update((draft) => {
          if (!draft.provider) draft.provider = {}
          draft.provider[providerID] = {
            name: providerName,
            npm: "@ai-sdk/openai-compatible",
            options: {
              baseURL: targetUrl,
              ...(key ? { apiKey: key } : {}),
            },
            models: Object.fromEntries(finalModels.map((m) => [m, { name: m }])),
          }
        })
        .catch(() => {})

      toast.show({
        variant: "success",
        message: `Provider "${providerName}" connected with ${finalModels.length} models!`,
      })
      props.onConnected?.(providerID)
    } catch (err: any) {
      toast.show({ variant: "error", message: `Failed to save provider: ${err?.message ?? err}` })
      props.onBack?.() ?? dialog.clear()
    }
  }

  return (
    <box>
      <Show when={step() === "url"}>
        <DialogPrompt
          title="Custom Provider: API Endpoint"
          subtitle="Enter OpenAI-compatible base URL (e.g. https://api.openai.com/v1 or http://localhost:11434/v1)"
          placeholder="https://api.openai.com/v1"
          value={url()}
          onConfirm={(val) => {
            const trimmed = val.trim()
            if (!trimmed) {
              setUrlError("Base URL cannot be empty")
              return
            }
            if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
              setUrlError("URL must start with http:// or https://")
              return
            }
            setUrlError("")
            setUrl(trimmed)
            setName(deriveDefaultName(trimmed))
            setStep("key")
          }}
          onCancel={() => {
            props.onBack?.() ?? dialog.clear()
          }}
          description={() => (
            <Show when={urlError()}>
              {(err) => <text fg={theme.text.feedback.error.base}>{err()}</text>}
            </Show>
          )}
        />
      </Show>

      <Show when={step() === "key"}>
        <DialogPrompt
          title="Custom Provider: API Key"
          subtitle="Enter your API key (press Enter to skip for local models without auth)"
          placeholder="sk-..."
          value={apiKey()}
          onConfirm={(val) => {
            setApiKey(val.trim())
            setStep("name")
          }}
          onCancel={() => setStep("url")}
        />
      </Show>

      <Show when={step() === "name"}>
        <DialogPrompt
          title="Custom Provider: Provider ID / Name"
          subtitle="Unique name identifier for this provider (e.g. 'groq', 'deepseek', 'ollama')"
          placeholder={deriveDefaultName(url())}
          value={name() || deriveDefaultName(url())}
          onConfirm={(val) => {
            const finalName = (val.trim() || deriveDefaultName(url())).toLowerCase().replace(/[^a-z0-9_-]/g, "-")
            setName(finalName)
            void startFetching(url(), apiKey(), finalName)
          }}
          onCancel={() => setStep("key")}
        />
      </Show>

      <Show when={step() === "fetching"}>
        <DialogPrompt
          title="Fetching Models..."
          subtitle={`Connecting to ${url()} and retrieving available models...`}
          busy={true}
          busyText="Fetching /models endpoint..."
          onCancel={() => setStep("name")}
        />
      </Show>

      <Show when={step() === "confirm"}>
        <DialogSelect
          title={`Found ${models().length} Model(s) for "${name()}"`}
          options={[
            {
              title: `✓ Save provider and register ${models().length} model(s)`,
              value: "save",
              description:
                models().slice(0, 4).join(", ") + (models().length > 4 ? ` (+${models().length - 4} more)` : ""),
            },
            ...models().slice(0, 50).map((m) => ({
              title: m,
              value: m,
              category: "Detected Models",
              disabled: true,
            })),
            {
              title: "+ Add another model ID manually",
              value: "add_manual",
              category: "Options",
            },
            {
              title: "← Change endpoint or API key",
              value: "back",
              category: "Options",
            },
          ]}
          onSelect={(opt) => {
            if (opt.value === "save") {
              void handleSaveAndConnect(models())
              return
            }
            if (opt.value === "add_manual") {
              setStep("manual")
              return
            }
            if (opt.value === "back") {
              setStep("url")
              return
            }
          }}
          onCancel={() => setStep("name")}
          footerHints={[
            { title: "confirm", label: "enter", group: "primary" },
            { title: "cancel", label: "esc", group: "secondary" },
          ]}
        />
      </Show>

      <Show when={step() === "manual"}>
        <DialogPrompt
          title="Custom Provider: Specify Model ID"
          subtitle={
            fetchError()
              ? `Auto-fetch failed (${fetchError()}). Enter model ID manually:`
              : "Enter model ID (or multiple comma-separated IDs):"
          }
          placeholder="e.g. gpt-4o, llama3, qwen-2.5"
          onConfirm={(val) => {
            const list = val
              .split(/[,\s]+/)
              .map((m) => m.trim())
              .filter(Boolean)
            if (list.length === 0) return
            const merged = Array.from(new Set([...models(), ...list]))
            setModels(merged)
            void handleSaveAndConnect(merged)
          }}
          onCancel={() => {
            if (models().length > 0) {
              setStep("confirm")
            } else {
              setStep("name")
            }
          }}
        />
      </Show>
    </box>
  )
}
