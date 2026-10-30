import { intro, log, outro } from "@clack/prompts"
import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { handlePromptErrors } from "../../ui/prompt"

export default Runtime.handler(
  Commands.commands.upgrade,
  Effect.fn("cli.upgrade")(
    function* () {
      intro("Upgrade")
      log.info("AntiTerm update system is disabled.")
      log.info("AntiTerm automatically synchronizes and presents itself as the latest version to the OpenCode proxy.")
      outro("No manual upgrade is needed. Your custom build is safe.")
    },
    (effect) => handlePromptErrors(effect),
  ),
)
