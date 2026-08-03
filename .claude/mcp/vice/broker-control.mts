// broker-control.mts
//
// N / D-01 (minimal, this task -- the remaining three request kinds
// (recycle/status/host_state), the arrival-ordered queue and the singleton
// guard are plan 05's). The subsystem's FIRST network listener: a TCP
// control plane replacing the bash broker's requests/grants/denials/leases
// directory tree entirely. One JSON object per line; the connection open IS
// the claim, connection close IS the release (T-01.6.2-01 through -09).
//
// Wire format confirmed at this plan's blocking checkpoint:decision
// (2026-08-03, `as-specified`, no amendments -- see .planning/RE-FINDINGS.md
// for the full record, including the two accepted residual risks and the
// unix-domain-socket dead end). Auth: per-boot capability token compared
// constant-time, checked BEFORE any state read or write. Bind: 0.0.0.0
// explicitly, never 127.0.0.1 -- host.docker.internal is the bridge
// address, not loopback, so a loopback-only listener is structurally
// unreachable from the container. Port: 19510 default via
// VICE_BROKER_CONTROL_PORT.
import { createServer, type Server, type Socket } from "node:net";
import { timingSafeEqual, randomBytes } from "node:crypto";

export type ControlErrorCode = "unauthorized" | "bad_request" | "denied" | "no_free_port" | "at_capacity" | "internal";

export interface ControlRequest {
  op: string;
  id?: string;
  token?: string;
  [key: string]: unknown;
}

export interface AcquireGrant {
  port: number;
  url: string;
  epochFile: string;
  supervisorDir: string;
}

export interface StartControlListenerOptions {
  host?: string;
  port?: number;
  token: string;
  /** Called on `acquire`, AFTER the token check has already passed. A null
   * return means "acquire failed" and is reported as an `internal` error --
   * plan 05 replaces this with the real denied/no_free_port/at_capacity
   * vocabulary once the full message set lands. */
  onAcquire: (requestId: string) => Promise<AcquireGrant | null>;
  /** Called on an explicit `release` request AND on connection close
   * (whichever happens first) -- the kernel enforces the release including
   * on the client's own SIGKILL, since close always fires either way. */
  onRelease: (requestId: string) => void;
}

export interface StartControlListenerResult {
  server: Server;
  port: number;
  host: string;
}

export type ControlResponse =
  | { kind: "grant"; id: string; port: number; url: string; epoch_file: string; supervisor_dir: string }
  | { kind: "released" }
  | { kind: "error"; code: ControlErrorCode; message: string };

/** 32 cryptographically random bytes rendered as hex -- the per-boot
 * capability token. Held in memory only by the caller; written once into
 * broker.json and never logged, never included in an error message
 * (T-01.6.2-02). */
export function newControlToken(): string {
  return randomBytes(32).toString("hex");
}

const MAX_LINE_BYTES = 65536;

function resolveControlPort(override?: number): number {
  if (typeof override === "number") return override;
  const raw = process.env.VICE_BROKER_CONTROL_PORT;
  if (raw === undefined || raw === "") return 19510;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 19510;
}

/** Constant-time token comparison over EQUAL-LENGTH buffers -- an
 * unequal-length comparison is refused without ever calling
 * timingSafeEqual (which throws on a length mismatch), so the length check
 * itself leaks nothing beyond what a fixed-length comparison already
 * would not avoid. */
function tokensMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function writeLine(socket: Socket, obj: ControlResponse): void {
  if (socket.writable) {
    socket.write(`${JSON.stringify(obj)}\n`);
  }
}

/** Starts the TCP control listener. Frames inbound bytes as
 * newline-delimited JSON: buffers, splits on "\n", parses each line with
 * the never-throw posture this codebase already uses for untrusted input --
 * a malformed line answers `bad_request` and the connection survives. A
 * connection exceeding MAX_LINE_BYTES without a newline is destroyed rather
 * than buffered further (T-01.6.2-04). */
export function startControlListener(opts: StartControlListenerOptions): Promise<StartControlListenerResult> {
  const host = opts.host ?? process.env.VICE_BROKER_CONTROL_HOST ?? "0.0.0.0";
  const port = resolveControlPort(opts.port);

  return new Promise((resolvePromise, reject) => {
    const server = createServer((socket) => {
      let buffer = "";
      let requestIdForThisConnection: string | null = null;

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES) {
          socket.destroy();
          return;
        }
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          handleLine(line);
        }
      });

      socket.on("close", () => {
        // Connection close IS the release -- including on the client's own
        // SIGKILL, since "close" always fires either way. Idempotent: an
        // explicit `release` already having cleared
        // requestIdForThisConnection makes this a no-op.
        if (requestIdForThisConnection) {
          const id = requestIdForThisConnection;
          requestIdForThisConnection = null;
          opts.onRelease(id);
        }
      });

      socket.on("error", () => {
        // Per-connection error handling isolates one peer's failure from
        // every other connection and from the server itself (T-01.6.2-06).
      });

      function handleLine(line: string): void {
        if (line.trim() === "") return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          writeLine(socket, { kind: "error", code: "bad_request" as ControlErrorCode, message: "malformed JSON line" });
          return;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          writeLine(socket, { kind: "error", code: "bad_request" as ControlErrorCode, message: "request must be a JSON object" });
          return;
        }
        const req = parsed as ControlRequest;

        // Token check BEFORE any state is read or written -- absence or
        // mismatch is refused, the connection is destroyed, and nothing is
        // allocated or spawned (T-01.6.2-01, T-01.6.2-03).
        const token = typeof req.token === "string" ? req.token : "";
        if (!tokensMatch(token, opts.token)) {
          writeLine(socket, { kind: "error", code: "unauthorized" as ControlErrorCode, message: "missing or invalid control token" });
          socket.destroy();
          return;
        }

        if (req.op === "acquire") {
          const requestId = typeof req.id === "string" && req.id !== "" ? req.id : `req-${process.pid}-${Date.now()}`;
          opts
            .onAcquire(requestId)
            .then((granted) => {
              if (!granted) {
                writeLine(socket, { kind: "error", code: "internal" as ControlErrorCode, message: "acquire failed" });
                return;
              }
              requestIdForThisConnection = requestId;
              writeLine(socket, {
                kind: "grant",
                id: requestId,
                port: granted.port,
                url: granted.url,
                epoch_file: granted.epochFile,
                supervisor_dir: granted.supervisorDir,
              });
            })
            .catch(() => {
              writeLine(socket, { kind: "error", code: "internal" as ControlErrorCode, message: "acquire threw" });
            });
        } else if (req.op === "release") {
          if (requestIdForThisConnection) {
            const id = requestIdForThisConnection;
            requestIdForThisConnection = null;
            opts.onRelease(id);
          }
          writeLine(socket, { kind: "released" });
        } else {
          // status/host_state/recycle -- plan 05's remaining three request
          // kinds. Unknown here, deliberately, per this task's scope.
          writeLine(socket, { kind: "error", code: "bad_request" as ControlErrorCode, message: `unknown or not-yet-implemented op: ${String(req.op)}` });
        }
      }
    });

    server.on("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr !== null ? addr.port : port;
      resolvePromise({ server, port: boundPort, host });
    });
  });
}
