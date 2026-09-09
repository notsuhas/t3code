import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createScheduledPromptEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial",
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  } as const;
  const revisions = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:scheduled-prompts:revisions",
    tag: WS_METHODS.scheduledPromptsSubscribe,
  });
  const refreshTrigger = ({ environmentId }: { readonly environmentId: EnvironmentId }) =>
    revisions({ environmentId, input: {} });
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:scheduled-prompts:list",
    tag: WS_METHODS.scheduledPromptsList,
    staleTimeMs: 30_000,
    refreshTrigger,
  });
  const get = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:scheduled-prompts:get",
    tag: WS_METHODS.scheduledPromptsGet,
    staleTimeMs: 30_000,
    refreshTrigger,
  });
  const runs = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:scheduled-prompts:runs",
    tag: WS_METHODS.scheduledPromptsRuns,
    staleTimeMs: 30_000,
    refreshTrigger,
  });
  const refreshList = (registry: AtomRegistry.AtomRegistry, environmentId: EnvironmentId) =>
    Effect.sync(() => registry.refresh(list({ environmentId, input: {} })));

  return {
    revisions,
    list,
    get,
    runs,
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scheduled-prompts:create",
      tag: WS_METHODS.scheduledPromptsCreate,
      scheduler: commandScheduler,
      concurrency,
      onSuccess: ({ environmentId }, registry) => refreshList(registry, environmentId),
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scheduled-prompts:update",
      tag: WS_METHODS.scheduledPromptsUpdate,
      scheduler: commandScheduler,
      concurrency,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() => {
          registry.refresh(list({ environmentId, input: {} }));
          registry.refresh(get({ environmentId, input: { id: input.id } }));
        }),
    }),
    delete: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scheduled-prompts:delete",
      tag: WS_METHODS.scheduledPromptsDelete,
      scheduler: commandScheduler,
      concurrency,
      onSuccess: ({ environmentId }, registry) => refreshList(registry, environmentId),
    }),
    setEnabled: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scheduled-prompts:set-enabled",
      tag: WS_METHODS.scheduledPromptsSetEnabled,
      scheduler: commandScheduler,
      concurrency,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() => {
          registry.refresh(list({ environmentId, input: {} }));
          registry.refresh(get({ environmentId, input: { id: input.id } }));
        }),
    }),
    runNow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:scheduled-prompts:run-now",
      tag: WS_METHODS.scheduledPromptsRunNow,
      scheduler: commandScheduler,
      concurrency,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() => {
          registry.refresh(list({ environmentId, input: {} }));
          registry.refresh(get({ environmentId, input: { id: input.id } }));
          registry.refresh(runs({ environmentId, input: { id: input.id } }));
        }),
    }),
  };
}
