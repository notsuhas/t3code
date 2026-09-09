import { createScheduledPromptEnvironmentAtoms } from "@t3tools/client-runtime/state/scheduled-prompts";

import { connectionAtomRuntime } from "../connection/runtime";

export const scheduledPromptEnvironment =
  createScheduledPromptEnvironmentAtoms(connectionAtomRuntime);
