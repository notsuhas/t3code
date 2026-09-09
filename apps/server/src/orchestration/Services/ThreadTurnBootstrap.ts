import type {
  CommandId,
  EventId,
  OrchestrationCommand,
  OrchestrationDispatchCommandError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export type BootstrapTurnStartCommand = Extract<
  OrchestrationCommand,
  { type: "thread.turn.start" }
>;

export interface ThreadTurnBootstrapOptions {
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Effect.Effect<{ readonly sequence: number }, unknown>;
  readonly commandId: (tag: string) => Effect.Effect<CommandId, OrchestrationDispatchCommandError>;
  readonly eventId: Effect.Effect<EventId, OrchestrationDispatchCommandError>;
}

export interface ThreadTurnBootstrapShape {
  readonly dispatch: (
    command: BootstrapTurnStartCommand,
    options: ThreadTurnBootstrapOptions,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
}

export class ThreadTurnBootstrap extends Context.Service<
  ThreadTurnBootstrap,
  ThreadTurnBootstrapShape
>()("t3/orchestration/Services/ThreadTurnBootstrap") {}
