export declare const LINK_VERSION: "v1";

export type LinkErrorCode = "unsupported" | "malformed" | "wrong-code" | "expired";

export declare class LinkError extends Error {
  constructor(code: LinkErrorCode);
  readonly code: LinkErrorCode;
}

export declare function isLinkSupported(): boolean;
export declare function makeUnlockCode(): string;
export declare function normalizeUnlockCode(code: string): string;

export type OpenedLink<T extends object = Record<string, unknown>> = T & { v: 1; exp?: number };

export declare function sealLink(
  payload: object,
  options: { app: string; days?: number; now?: number; compress?: boolean },
): Promise<{ token: string; code: string }>;

export declare function openLink<T extends object = Record<string, unknown>>(
  token: string,
  code: string,
  options: { app: string; previousApps?: string[]; now?: number; accept?: (body: OpenedLink<T>) => boolean },
): Promise<OpenedLink<T>>;

export declare function readLinkToken(hash?: string, name?: string): string | null;

export declare function forgetLinkToken(
  name?: string,
  options?: {
    location?: { pathname: string; search: string; hash: string };
    history?: { state: unknown; replaceState(state: unknown, unused: string, url: string): void };
  },
): boolean;
