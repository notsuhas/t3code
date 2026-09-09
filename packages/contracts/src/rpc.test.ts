import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { WS_METHODS, WsSubscribeServerConfigRpc } from "./rpc.ts";

/**
 * The client always sends `environmentThemes`, including to servers built
 * before the field existed, whose payload schema was an empty struct. What
 * makes that safe is that such a schema accepts the request rather than
 * rejecting it -- an error here would take down the config subscription.
 */
describe("subscribeServerConfig payload compatibility", () => {
  it("is accepted by a server whose schema predates the field", () => {
    const oldServerPayload = Schema.Struct({});
    const decoded = Schema.decodeUnknownExit(oldServerPayload)({ environmentThemes: true });
    expect(Exit.isSuccess(decoded)).toBe(true);
  });

  it("is carried by a server that declares it", () => {
    const decoded = Schema.decodeUnknownSync(WsSubscribeServerConfigRpc.payloadSchema)({
      environmentThemes: true,
    });
    expect(decoded).toEqual({ environmentThemes: true });
  });

  it("stays optional, so a client that never sends it still subscribes", () => {
    const decoded = Schema.decodeUnknownSync(WsSubscribeServerConfigRpc.payloadSchema)({});
    expect(decoded).toEqual({});
  });
});

describe("scheduled prompt RPC methods", () => {
  it("publishes the complete schedule API", () => {
    expect({
      list: WS_METHODS.scheduledPromptsList,
      get: WS_METHODS.scheduledPromptsGet,
      create: WS_METHODS.scheduledPromptsCreate,
      update: WS_METHODS.scheduledPromptsUpdate,
      delete: WS_METHODS.scheduledPromptsDelete,
      setEnabled: WS_METHODS.scheduledPromptsSetEnabled,
      runNow: WS_METHODS.scheduledPromptsRunNow,
      runs: WS_METHODS.scheduledPromptsRuns,
      subscribe: WS_METHODS.scheduledPromptsSubscribe,
    }).toEqual({
      list: "scheduledPrompts.list",
      get: "scheduledPrompts.get",
      create: "scheduledPrompts.create",
      update: "scheduledPrompts.update",
      delete: "scheduledPrompts.delete",
      setEnabled: "scheduledPrompts.setEnabled",
      runNow: "scheduledPrompts.runNow",
      runs: "scheduledPrompts.runs",
      subscribe: "scheduledPrompts.subscribe",
    });
  });
});
