import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { useData } from "../context/data"
import { useClient } from "../context/client"
import { pipe, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { McpServer } from "@opencode/client"
import { useToast } from "../ui/toast"
import { DialogErrorDetails } from "./dialog-error-details"
import { DialogIntegration } from "./dialog-integration"
import { useLocation } from "../context/location"
import { useConfig } from "../config"
import { isMcpStartupEnabled, setMcpStartup, isMcpDisabled, setMcpDisabled } from "@opencode/core/mcp/preference"

function statusError(status: McpServer["status"]) {
  if (status.status === "failed" || status.status === "needs_auth") return status.error
  return undefined
}

function Status(props: { server: McpServer; disabled?: boolean; loading: boolean }) {
  if (props.loading || props.server.status.status === "pending") {
    return <>Connecting …</>
  }
  if (props.server.status.status === "connected") {
    return <span style={{ attributes: TextAttributes.BOLD }}>Connected ✓</span>
  }
  if (props.server.status.status === "failed") {
    return <>Failed !</>
  }
  if (props.server.status.status === "needs_auth") {
    return <>Sign in required →</>
  }
  if (props.disabled || props.server.disabled) {
    return <>Disabled ✕</>
  }
  return <>Disconnected ○</>
}

export function DialogMcp(props: { initialServer?: string; details?: boolean } = {}) {
  const data = useData()
  const dialog = useDialog()
  const client = useClient()
  const location = useLocation()
  const config = useConfig()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const current = () => location.ref ?? data.location.default()
  const [tick, setTick] = createSignal(0)

  const servers = createMemo(() => {
    tick()
    return pipe(
      data.location.mcp.server.list(current()) ?? [],
      sortBy((server) => server.name),
    )
  })

  const initial = props.initialServer ? servers().find((server) => server.name === props.initialServer) : undefined
  const [focused, setFocused] = createSignal<string | undefined>(props.initialServer)
  const [manageServer, setManageServer] = createSignal<string | undefined>()
  const [detail, setDetail] = createSignal<McpServer | undefined>(
    props.details && initial?.status.status === "failed" ? initial : undefined,
  )
  const [loading, setLoading] = createSignal<ReadonlySet<string>>(new Set())

  const statusColor = (server: McpServer, disabled: boolean) => {
    if (server.status.status === "connected") return theme.text.feedback.success.base
    if (server.status.status === "failed") return theme.text.feedback.error.base
    if (server.status.status === "needs_auth") return theme.text.feedback.warning.base
    if (disabled || server.disabled) return theme.text.muted
    return theme.text.muted
  }

  createEffect(() => {
    if (focused()) return
    const first = servers()[0]
    if (first) setFocused(first.name)
  })

  const focusedServer = createMemo(() => {
    tick()
    return servers().find((server) => server.name === focused())
  })

  const focusedError = createMemo(() => {
    const server = focusedServer()
    if (server?.status.status === "needs_auth" && server.integrationID) return undefined
    return server ? statusError(server.status) : undefined
  })

  const options = createMemo(() => {
    const loadingMcp = loading()
    tick()
    return servers().map((server) => {
      const pending = loadingMcp.has(server.name) || server.status.status === "pending"
      const isStartup = server.startup === true || isMcpStartupEnabled(server.name)
      const isDisabled = server.disabled === true || isMcpDisabled(server.name)

      return {
        value: server.name,
        title: server.name,
        footer: (
          <>
            <span style={{ fg: isStartup ? theme.text.action.primary.base : theme.text.muted }}>
              {isStartup ? "[startup: on] " : "[startup: off] "}
            </span>
            <Status server={server} disabled={isDisabled} loading={pending} />
          </>
        ),
        footerColor: pending ? theme.text.muted : statusColor(server, isDisabled),
      }
    })
  })

  const toggleTitle = createMemo(() => {
    const status = focusedServer()?.status.status
    if (status === "connected") return "disconnect"
    if (status === "failed") return "retry"
    if (status === "needs_auth") return "sign in"
    return "connect"
  })

  const toggleStartup = (name: string) => {
    const server = servers().find((s) => s.name === name)
    const currentVal = server?.startup === true || isMcpStartupEnabled(name)
    const next = !currentVal
    setMcpStartup(name, next)
    void config
      .update((draft) => {
        if (draft.mcp?.servers?.[name]) {
          draft.mcp.servers[name].startup = next
          draft.mcp.servers[name].connect_on_startup = next
        }
      })
      .catch(() => {})
    toast.show({ variant: "info", message: `${name}: Connect on startup ${next ? "enabled (ON)" : "disabled (OFF)"}` })
    setTick((t) => t + 1)
  }

  const toggleDisable = async (name: string) => {
    const server = servers().find((s) => s.name === name)
    const currentlyDisabled = server?.disabled === true || isMcpDisabled(name)
    const next = !currentlyDisabled
    setMcpDisabled(name, next)
    void config
      .update((draft) => {
        if (draft.mcp?.servers?.[name]) {
          draft.mcp.servers[name].disabled = next
        }
      })
      .catch(() => {})

    if (next) {
      if (server?.status.status === "connected") {
        const target = current()
        await client.api.mcp.disconnect({ server: name, location: { directory: target.directory } }).catch(() => {})
      }
      toast.show({ variant: "info", message: `${name}: Disabled` })
    } else {
      toast.show({ variant: "info", message: `${name}: Enabled` })
    }
    setTick((t) => t + 1)
  }

  const connectServer = async (name: string) => {
    if (loading().has(name)) return
    const server = servers().find((entry) => entry.name === name)
    if (!server || server.status.status === "pending") return

    if (server.status.status === "needs_auth" && server.integrationID) {
      dialog.replace(() => <DialogIntegration integrationID={server.integrationID} autoConnect />)
      return
    }

    setMcpDisabled(name, false)
    void config
      .update((draft) => {
        if (draft.mcp?.servers?.[name]?.disabled) {
          draft.mcp.servers[name].disabled = false
        }
      })
      .catch(() => {})

    setLoading((prev) => new Set(prev).add(name))
    const target = current()
    const input = { server: name, location: { directory: target.directory } }
    const call = server.status.status === "connected" ? client.api.mcp.disconnect(input) : client.api.mcp.connect(input)
    void call
      .then(() => {
        toast.show({
          variant: "info",
          message: `${name}: ${server.status.status === "connected" ? "Disconnected" : "Connected"}`,
        })
      })
      .catch(toast.error)
      .finally(() => {
        setLoading((prev) => {
          const next = new Set(prev)
          next.delete(name)
          return next
        })
        setTick((t) => t + 1)
      })
  }

  const currentManageServer = createMemo(() => {
    const name = manageServer()
    tick()
    return servers().find((s) => s.name === name)
  })

  const manageOptions = createMemo(() => {
    const server = currentManageServer()
    if (!server) return []
    const isConnected = server.status.status === "connected"
    const isPending = loading().has(server.name) || server.status.status === "pending"
    const isStartup = server.startup === true || isMcpStartupEnabled(server.name)
    const isDisabled = server.disabled === true || isMcpDisabled(server.name)

    const items = [
      {
        value: "connect",
        title: isConnected ? "Disconnect" : "Connect",
        description: isConnected ? "Disconnect active MCP server process" : "Connect to this MCP server now",
        footer: isPending ? "Connecting …" : isConnected ? "Connected ✓" : "Disconnected ○",
      },
      {
        value: "disable",
        title: isDisabled ? "Enable server" : "Disable server",
        description: isDisabled
          ? "Re-enable this server so it can be connected and used"
          : "Disable this server (prevent connections and tool execution)",
        footer: isDisabled ? "Disabled ✕" : "Enabled",
      },
      {
        value: "startup",
        title: `Connect on startup: [ ${isStartup ? "ON" : "OFF"} ]`,
        description: `Toggle auto-connect when AntiTerm launches (currently: ${isStartup ? "ON" : "OFF"})`,
        footer: isStartup ? "[startup: on]" : "[startup: off]",
      },
    ]

    if (statusError(server.status)) {
      items.push({
        value: "error",
        title: "View error details",
        description: statusError(server.status) ?? "",
        footer: "Failed !",
      })
    }

    items.push({
      value: "back",
      title: "← Back to servers list",
      description: "Return to the MCP servers list",
      footer: "",
    })

    return items
  })

  const handleManageSelect = async (action: string) => {
    const serverName = manageServer()
    if (!serverName) return

    if (action === "back") {
      setManageServer(undefined)
      return
    }

    if (action === "connect") {
      await connectServer(serverName)
      return
    }

    if (action === "disable") {
      await toggleDisable(serverName)
      return
    }

    if (action === "startup") {
      toggleStartup(serverName)
      return
    }

    if (action === "error") {
      const server = servers().find((s) => s.name === serverName)
      if (server) setDetail(server)
      return
    }
  }

  return (
    <box>
      <Show when={detail()}>
        {(server) => (
          <DialogErrorDetails
            title={`MCP server: ${server().name}`}
            error={statusError(server().status) ?? "Unknown MCP connection error"}
            context={`Status: ${server().status.status}\nConfiguration: mcp.servers.${server().name}${
              server().integrationID ? `\nIntegration: ${server().integrationID}` : ""
            }`}
            onBack={() => {
              setDetail(undefined)
              dialog.setSize("medium")
            }}
          />
        )}
      </Show>

      <Show when={!detail()}>
        <Show
          when={manageServer()}
          fallback={
            <DialogSelect
              title="MCP servers"
              searchInTitle
              titlePlaceholder="Search MCP servers"
              options={options()}
              preserveSelection
              onMove={(option) => setFocused(option.value as string)}
              onSelect={(option) => {
                const serverName = option.value as string
                const server = servers().find((s) => s.name === serverName)
                if (server?.status.status === "needs_auth" && server.integrationID) {
                  dialog.replace(() => <DialogIntegration integrationID={server.integrationID} autoConnect />)
                  return
                }
                if (server && statusError(server.status)) {
                  setDetail(server)
                  return
                }
                setManageServer(serverName)
              }}
              actions={[
                {
                  title: toggleTitle(),
                  command: "dialog.mcp.toggle",
                  onTrigger: (option) => {
                    setFocused(option.value as string)
                    void connectServer(option.value as string)
                  },
                },
                {
                  title: focusedServer()?.disabled || isMcpDisabled(focusedServer()?.name ?? "") ? "enable" : "disable",
                  command: "dialog.mcp.disable",
                  bind: "d",
                  onTrigger: (option) => {
                    setFocused(option.value as string)
                    void toggleDisable(option.value as string)
                  },
                },
                {
                  title: (focusedServer()?.startup ?? isMcpStartupEnabled(focusedServer()?.name ?? ""))
                    ? "startup: off"
                    : "startup: on",
                  command: "dialog.mcp.startup",
                  bind: "s",
                  onTrigger: (option) => {
                    setFocused(option.value as string)
                    toggleStartup(option.value as string)
                  },
                },
              ]}
              footerHints={
                focusedError()
                  ? [{ title: "view error", label: "enter", group: "primary" as const }]
                  : [{ title: "manage", label: "enter", group: "primary" as const }]
              }
            />
          }
        >
          {(serverName) => (
            <DialogSelect
              title={`MCP: ${serverName()}`}
              searchInTitle
              titlePlaceholder="Choose action"
              options={manageOptions()}
              onSelect={(option) => void handleManageSelect(option.value as string)}
              onCancel={() => setManageServer(undefined)}
              footerHints={[{ title: "select", label: "enter", group: "primary" as const }]}
            />
          )}
        </Show>
      </Show>
    </box>
  )
}
