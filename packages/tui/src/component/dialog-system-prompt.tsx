import { TextareaRenderable } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog, type DialogContext } from "../ui/dialog"
import { createSignal, onMount } from "solid-js"
import { useClient } from "../context/client"
import { useToast } from "../ui/toast"
import { useLocal } from "../context/local"
import { useData } from "../context/data"
import { useConfig } from "../config"
import { errorMessage } from "../util/error"

export function DialogSystemPrompt(props: {
  sessionID?: string
  currentMetadata?: Record<string, unknown>
}) {
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const local = useLocal()
  const data = useData()
  const config = useConfig().data
  const theme = useTheme().surface("dialog")

  const initialText = () => {
    if (props.sessionID) {
      return (props.currentMetadata?.systemPrompt as string | undefined) ?? ""
    }
    return local.systemPrompt.get() ?? ""
  }

  const [text, setText] = createSignal(initialText())
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  let textarea: TextareaRenderable

  const lineCount = () => (text() ? text().split("\n").length : 0)
  const charCount = () => text().length

  async function save() {
    const value = textarea?.plainText?.trim() ?? ""
    try {
      if (props.sessionID) {
        const metadata: Record<string, any> = { ...(props.currentMetadata ?? {}) }
        if (value) {
          metadata.systemPrompt = value
        } else {
          delete metadata.systemPrompt
        }
        await client.api.session.update({ sessionID: props.sessionID, metadata })
        data.session.invalidate(props.sessionID)
        await data.session.sync(props.sessionID)
        toast.show({
          message: value ? "System prompt updated for this session" : "System prompt reset to default",
          variant: "info",
        })
      } else {
        local.systemPrompt.set(value || undefined)
        toast.show({
          message: value ? "System prompt set for new sessions" : "System prompt cleared",
          variant: "info",
        })
      }
      dialog.clear()
    } catch (error) {
      toast.show({
        message: `Failed to save system prompt: ${errorMessage(error)}`,
        variant: "error",
      })
    }
  }

  async function clear() {
    if (textarea && !textarea.isDestroyed) {
      textarea.setText("")
      setText("")
    }
    toast.show({
      message: "Text cleared. Press Ctrl+S to save as empty.",
      variant: "info",
    })
  }

  async function reset() {
    try {
      const defaultPrompt = local.systemPrompt.default() ?? ""
      if (props.sessionID) {
        const metadata: Record<string, any> = { ...(props.currentMetadata ?? {}) }
        if (defaultPrompt) {
          metadata.systemPrompt = defaultPrompt
        } else {
          delete metadata.systemPrompt
        }
        await client.api.session.update({ sessionID: props.sessionID, metadata })
        data.session.invalidate(props.sessionID)
        await data.session.sync(props.sessionID)
        toast.show({
          message: defaultPrompt ? "Session system prompt reset to default" : "System prompt removed",
          variant: "info",
        })
      } else {
        local.systemPrompt.reset()
        toast.show({
          message: defaultPrompt ? "System prompt reset to default" : "System prompt cleared",
          variant: "info",
        })
      }
      if (textarea && !textarea.isDestroyed) {
        textarea.setText(defaultPrompt)
        setText(defaultPrompt)
      }
      dialog.clear()
    } catch (error) {
      toast.show({
        message: `Failed to reset system prompt: ${errorMessage(error)}`,
        variant: "error",
      })
    }
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    target: textareaTarget,
    enabled: textareaTarget() !== undefined,
    priority: 1,
    commands: [
      {
        id: "dialog.system_prompt.save",
        title: "Save system prompt",
        bind: "ctrl+s",
        group: "Dialog",
        run: save,
      },
      {
        id: "dialog.system_prompt.clear",
        title: "Clear text",
        bind: "ctrl+k",
        group: "Dialog",
        run: clear,
      },
      {
        id: "dialog.system_prompt.reset",
        title: "Reset system prompt",
        bind: "ctrl+r",
        group: "Dialog",
        run: reset,
      },
      {
        id: "dialog.system_prompt.cancel",
        title: "Cancel",
        bind: "escape",
        group: "Dialog",
        run: () => dialog.clear(),
      },
    ],
  }))

  onMount(() => {
    dialog.setSize("large")
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
      textarea.gotoLineEnd()
    }, 10)
  })

  return (
    <DialogLayout
      header={
        <DialogHeader
          title="System Prompt"
          description={
            props.sessionID
              ? "Paste or edit the system prompt for the current session"
              : "Paste or edit the default system prompt for new sessions"
          }
          onClose={() => dialog.clear()}
        />
      }
      footer={{
        actions: {
          secondary: [
            {
              title: "save",
              command: "dialog.system_prompt.save",
              onTrigger: save,
            },
            {
              title: "clear",
              command: "dialog.system_prompt.clear",
              onTrigger: clear,
            },
            {
              title: "reset default",
              command: "dialog.system_prompt.reset",
              onTrigger: reset,
            },
          ],
          primary: [
            {
              title: "cancel",
              command: "dialog.system_prompt.cancel",
              onTrigger: () => dialog.clear(),
            },
          ],
        },
      }}
    >
      <box gap={1}>
        <box
          border
          borderStyle="single"
          borderColor={theme.border.base}
          paddingLeft={1}
          paddingRight={1}
        >
          <textarea
            height={14}
            wrapMode="word"
            ref={(val: TextareaRenderable) => {
              textarea = val
              setTextareaTarget(val)
            }}
            initialValue={initialText()}
            placeholder="Paste your system prompt here... (Empty to use default AntiTerm prompt)"
            placeholderColor={theme.text.muted}
            textColor={theme.text.formfield.base}
            focusedTextColor={theme.text.formfield.base}
            cursorColor={theme.text.base}
            cursorStyle={config.cursor}
            onContentChange={() => {
              if (textarea) setText(textarea.plainText)
            }}
          />
        </box>
        <box flexDirection="row" justifyContent="flex-start">
          <text fg={theme.text.muted}>
            {lineCount()} lines • {charCount()} chars
          </text>
        </box>
      </box>
    </DialogLayout>
  )
}

DialogSystemPrompt.show = (
  dialog: DialogContext,
  sessionID?: string,
  currentMetadata?: Record<string, unknown>,
) => dialog.replace(() => <DialogSystemPrompt sessionID={sessionID} currentMetadata={currentMetadata} />)
