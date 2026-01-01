import { actionHandlers } from "./actions/index.js";
import type {
  ActionContext,
  BrowserActionRequest,
  ChromeClientInterface,
  StateManagerInterface,
} from "./actions/types.js";

/**
 * Create an ActionContext shared by both MCP server and CLI.
 */
export function makeContext(
  chrome: ChromeClientInterface,
  state: StateManagerInterface
): ActionContext {
  const ctx: ActionContext = {
    chrome,
    state,
    run: async (request: BrowserActionRequest) => {
      const handler = actionHandlers[request.action];
      if (!handler) {
        return {
          success: false,
          action: request.action,
          error: `Unknown action: ${request.action}`,
        };
      }
      return handler(request, ctx);
    },
  };
  return ctx;
}
