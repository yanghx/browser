/**
 * @params recipe metadata — parsed from /* @params { JSON } * / comment blocks
 * in .js recipe files.
 *
 * Each recipe is a standalone async function that runs inside a browser tab
 * via eval, using fetch() with the browser's cookies for authenticated API access.
 */

export interface SiteMeta {
  name: string;           // "twitter/thread" — format: "site/action"
  description: string;
  domain: string;         // "x.com" — used for tab matching
  args: Record<string, ArgDef>;
  capabilities?: string[];
  readOnly?: boolean;
  example?: string;
  filePath: string;       // absolute path to .js file
  source: "local" | "community";
}

export interface ArgDef {
  required?: boolean;
  description?: string;
}
