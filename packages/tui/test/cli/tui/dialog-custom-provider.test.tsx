import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  fetchOpenAIModels,
  saveCustomProvider,
  getCustomProviders,
  deleteCustomProvider,
  refreshAllCustomProviderModels,
} from "../../../src/component/dialog-custom-provider"

describe("fetchOpenAIModels", () => {
  test("fetches models from standard OpenAI response format", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url)
      if (urlStr.includes("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o", object: "model" },
              { id: "gpt-4o-mini", object: "model" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response("Not found", { status: 404 })
    }) as any

    try {
      const models = await fetchOpenAIModels("https://api.openai.com/v1", "test-key")
      expect(models).toEqual(["gpt-4o", "gpt-4o-mini"])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("fetches models from Ollama / array response format", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url)
      if (urlStr.includes("/models")) {
        return new Response(
          JSON.stringify({
            models: [
              { name: "llama3:latest" },
              { name: "mistral:latest" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response("Not found", { status: 404 })
    }) as any

    try {
      const models = await fetchOpenAIModels("http://localhost:11434")
      expect(models).toEqual(["llama3:latest", "mistral:latest"])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("custom provider CRUD & refresh", () => {
  const tmpDir = path.join(os.tmpdir(), `opencode-test-${Date.now()}`)
  const originalEnv = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = tmpDir

  test("saves, retrieves, and deletes a custom provider", () => {
    try {
      saveCustomProvider({
        providerID: "test-provider",
        name: "Test AI",
        baseURL: "http://localhost:8000/v1",
        apiKey: "sk-test",
        models: ["model-1", "model-2"],
      })

      const list = getCustomProviders()
      expect(list.length).toBe(1)
      expect(list[0].id).toBe("test-provider")
      expect(list[0].name).toBe("Test AI")
      expect(list[0].baseURL).toBe("http://localhost:8000/v1")
      expect(list[0].models).toEqual(["model-1", "model-2"])

      // Delete the provider
      deleteCustomProvider("test-provider")
      const afterDelete = getCustomProviders()
      expect(afterDelete.length).toBe(0)
    } finally {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    }
  })

  test("refreshAllCustomProviderModels re-fetches models for configured custom providers", async () => {
    try {
      saveCustomProvider({
        providerID: "refresh-provider",
        name: "Refresh AI",
        baseURL: "http://mock-ai:1234/v1",
        apiKey: "sk-refresh",
        models: ["old-model"],
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: string | URL | Request) => {
        return new Response(
          JSON.stringify({
            data: [{ id: "new-model-a" }, { id: "new-model-b" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }) as any

      try {
        const result = await refreshAllCustomProviderModels()
        expect(result.total).toBe(1)
        expect(result.updated).toBe(1)
        expect(result.errors).toEqual([])

        const providers = getCustomProviders()
        expect(providers[0].models).toEqual(["new-model-a", "new-model-b"])
      } finally {
        globalThis.fetch = originalFetch
      }
    } finally {
      process.env.OPENCODE_CONFIG_DIR = originalEnv
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    }
  })
})
