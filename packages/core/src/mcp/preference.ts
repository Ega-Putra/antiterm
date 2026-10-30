import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export interface McpPreferences {
  startup: Record<string, boolean>
  disabled: Record<string, boolean>
}

export function getMcpPreferencePath(): string {
  const dir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode")
  return path.join(dir, "antiterm-mcp.json")
}

export function loadMcpPreferences(): McpPreferences {
  const file = getMcpPreferencePath()
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"))
      return {
        startup: typeof data.startup === "object" && data.startup ? data.startup : {},
        disabled: typeof data.disabled === "object" && data.disabled ? data.disabled : {},
      }
    }
  } catch {}
  return { startup: {}, disabled: {} }
}

export function saveMcpPreferences(prefs: McpPreferences) {
  const file = getMcpPreferencePath()
  try {
    const dir = path.dirname(file)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(file, JSON.stringify(prefs, null, 2), "utf8")
  } catch {}
}

export function isMcpStartupEnabled(
  serverName: string,
  config?: { startup?: boolean; connect_on_startup?: boolean; connectOnStartup?: boolean },
): boolean {
  if (config?.startup !== undefined) return config.startup
  if (config?.connect_on_startup !== undefined) return config.connect_on_startup
  if (config?.connectOnStartup !== undefined) return config.connectOnStartup
  const prefs = loadMcpPreferences()
  return prefs.startup[serverName] === true
}

export function setMcpStartup(serverName: string, enabled: boolean) {
  const prefs = loadMcpPreferences()
  prefs.startup[serverName] = enabled
  saveMcpPreferences(prefs)
}

export function isMcpDisabled(serverName: string, config?: { disabled?: boolean }): boolean {
  if (config?.disabled === true) return true
  const prefs = loadMcpPreferences()
  return prefs.disabled[serverName] === true
}

export function setMcpDisabled(serverName: string, disabled: boolean) {
  const prefs = loadMcpPreferences()
  prefs.disabled[serverName] = disabled
  saveMcpPreferences(prefs)
}
