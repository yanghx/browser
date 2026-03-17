/**
 * @params recipe metadata — parsed from /* @params { JSON } * / comment blocks
 * in .js recipe files.
 */

export interface SiteMeta {
  name: string;           // "twitter/thread" — format: "site/action"
  description: string;
  domain: string;         // "x.com" — used for tab matching
  args: Record<string, ArgDef>;
  capabilities?: string[];
  readOnly?: boolean;
  example?: string;
  runtime?: "node" | "browser"; // "node" = run directly in Node.js, "browser" = inject into Chrome (default)
  auth?: "cookie" | "bearer+csrf" | "bearer+csrf+webpack"; // auth method (node runtime reads from auth.json)
  filePath: string;       // absolute path to .js file
  source: "local" | "community";
}

export interface ArgDef {
  required?: boolean;
  description?: string;
}
