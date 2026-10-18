// The bits of node the sim / tune CLIs use (the project has no @types/node).
declare const process: { argv: string[]; exit(code?: number): never; stdout: { write(s: string): boolean } };
declare module 'node:worker_threads' {
  export const isMainThread: boolean;
  export const workerData: unknown;
  export const parentPort: { postMessage(m: unknown): void } | null;
  export class Worker {
    constructor(file: URL | string, opts?: { workerData?: unknown });
    on(ev: 'message', f: (m: unknown) => void): this;
    on(ev: 'error', f: (e: Error) => void): this;
    on(ev: 'exit', f: (code: number) => void): this;
  }
}
declare module 'node:os' {
  export function availableParallelism(): number;
}
declare module 'node:fs' {
  export function readFileSync(path: string, enc: 'utf8'): string;
  export function writeFileSync(path: string, data: string, enc?: 'utf8'): void;
}
