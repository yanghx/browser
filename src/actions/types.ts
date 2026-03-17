export const ACTION_TYPES = [
  // Navigation
  "browse", "back", "forward",
  // Interaction
  "click", "fill", "type", "hover", "press", "scroll", "select",
  // Observation
  "snapshot", "screenshot", "search", "state", "wait",
  // Extraction
  "extract", "eval",
  // Network
  "network",
  // Tabs
  "tab_list", "tab_new", "tab_select", "close",
  // Site recipes
  "site",
  // Dev/debug
  "dev",
  // Auth
  "auth",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export interface BrowserActionRequest {
  action: ActionType;

  // Navigation
  url?: string;
  waitFor?: string;

  // Interaction
  target?: string;
  value?: string;

  // Extraction
  selector?: string;
  format?: "json" | "markdown" | "csv";

  // JS execution
  script?: string;

  // Network
  resourceTypes?: string[];
  urlPattern?: string;

  // Tabs
  tabId?: number;

  // Site recipes
  site?: string;
  siteAction?: string;
  args?: Record<string, string>;

  // Dev/debug
  devAction?:
    | "inspect"
    | "test-selector"
    | "test-script"
    | "record"
    | "trace"
    | "replay"
    | "codegen"
    | "network-log"
    | "cli";
  lang?: "ts" | "python";
  output?: string;
}

export interface BrowserActionResponse {
  success: boolean;
  action: ActionType;
  data?: {
    title?: string;
    url?: string;
    content?: string;
    elements?: Array<{ uid: string; role: string; name: string }>;
    items?: any[];
    result?: any;
    requests?: Array<{
      url: string;
      method: string;
      status: number;
      type: string;
      size?: number;
      duration?: number;
    }>;
    tabs?: Array<{ id: number; title: string; url: string }>;
    screenshot?: string;
  };
  error?: string;
}

export type ActionHandler = (
  request: BrowserActionRequest,
  ctx: ActionContext
) => Promise<BrowserActionResponse>;

export interface ActionContext {
  chrome: ChromeClientInterface;
  state: StateManagerInterface;
  run: (request: BrowserActionRequest) => Promise<BrowserActionResponse>;
}

export interface ChromeClientInterface {
  callTool(name: string, args?: Record<string, any>): Promise<any>;
}

export interface StateManagerInterface {
  getCachedSnapshot(): ParsedSnapshot | null;
  setCachedSnapshot(snapshot: ParsedSnapshot): void;
  invalidateCache(): void;
  getSnapshotCacheTTL(): number;
}

export interface ParsedSnapshot {
  raw: string;
  elements: ElementInfo[];
  timestamp: number;
}

export interface ElementInfo {
  uid: string;
  role: string;
  name: string;
  text: string;
}
