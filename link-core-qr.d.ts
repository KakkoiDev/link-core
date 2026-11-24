export type QrEcc = "L" | "M" | "Q" | "H";
export declare function qrCapacity(version: number, ecc?: QrEcc): number;
export declare function qrMatrix(text: string, options?: { ecc?: QrEcc; minVersion?: number }): { version: number; size: number; modules: boolean[][] };
export declare function qrSvg(text: string, options?: { ecc?: QrEcc; border?: number; dark?: string; light?: string | null; label?: string }): string;
