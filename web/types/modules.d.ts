// Packages used by the mock-paper importer that ship no type declarations.
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
}

declare module "@mixmark-io/domino" {
  export function createDocument(html?: string, force?: boolean): Document;
}
