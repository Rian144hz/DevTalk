// GitHub sign-in comes back to the app through the browser: Supabase redirects to http://127.0.0.1:<port>/callback
// with a one-time code (useless without the PKCE verifier kept in the main process). This is that tiny listener.
// Rules: 127.0.0.1 only; the first free port of OAUTH_PORTS; one /callback is accepted and then everything closes;
// any other path gets 404 and the wait goes on; the timeout, an abort (Cancel) or close() end the wait.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export const OAUTH_HOST = '127.0.0.1';
export const OAUTH_PORTS = [53682, 53683, 53684] as const;
export const OAUTH_TIMEOUT_MS = 300_000;
export const NOT_FINISHED_MESSAGE = 'Sign-in was not finished. Try again.';
export const PORTS_BUSY_MESSAGE = 'Could not start GitHub sign-in. Close other apps that use ports 53682–53684 and try again.';

export type LoopbackResult = { code: string } | { error: string };

export interface Loopback {
  /** Where Supabase must send the browser back to. */
  redirectTo: string;
  /** The first /callback, or NOT_FINISHED_MESSAGE on timeout, abort or close(). Resolves once the port is free again. */
  result: Promise<LoopbackResult>;
  /** Stops listening (idempotent). While still waiting, the result becomes "not finished". */
  close(): void;
}

export interface LoopbackOptions {
  ports?: readonly number[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Longest error text echoed on the page or passed on (it comes from the URL, so anyone could have written it). */
const MAX_ERROR_TEXT = 200;
const MAX_CODE_LENGTH = 2048;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Plain text in a minimal page: no scripts, styles, images or links, so it loads nothing. */
function page(message: string | null): string {
  const lines = [message ? `<p>${escapeHtml(message)}</p>` : '', '<p>You can go back to DevTalk.</p>'].join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>DevTalk</title></head><body><h1>DevTalk</h1>${lines}</body></html>`;
}

const HEADERS = {
  'Cache-Control': 'no-store',
  Connection: 'close',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'",
};

/** Plain text taken from a query value: control characters out, whitespace squeezed, length capped. */
function cleanText(raw: string): string {
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, MAX_ERROR_TEXT).join('');
}

/** Listens on one port; null when it is taken (or not allowed), so the next one can be tried. */
function listenOn(
  port: number,
  onRequest: (req: IncomingMessage, res: ServerResponse) => void,
  onConnection: (socket: Socket) => void,
): Promise<Server | null> {
  return new Promise((resolve, reject) => {
    const server = createServer(onRequest);
    server.on('connection', onConnection);
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolve(null);
      else reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, OAUTH_HOST);
  });
}

/** Opens the listener on the first free port. Rejects with "ports busy" when none of them is free. */
export async function openLoopback(o: LoopbackOptions = {}): Promise<Loopback> {
  const ports = o.ports ?? OAUTH_PORTS;
  const timeoutMs = o.timeoutMs ?? OAUTH_TIMEOUT_MS;
  const sockets = new Set<Socket>();
  let done = false;
  let server: Server | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult!: (r: LoopbackResult) => void;
  const result = new Promise<LoopbackResult>((resolve) => (resolveResult = resolve));

  const dropSockets = () => {
    for (const s of sockets) s.destroy();
    sockets.clear();
  };

  /** Ends the wait once: stops accepting at once, then resolves when the port is free again. */
  const finish = (outcome: LoopbackResult, keepOpenUntil?: ServerResponse) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
    const s = server!;
    s.close(() => resolveResult(outcome));
    // The callback's own answer is still being written: drop the connections once it has gone out.
    if (keepOpenUntil) keepOpenUntil.once('close', dropSockets);
    else dropSockets();
  };

  const onConnection = (socket: Socket) => {
    if (done) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };

  const onAbort = () => finish({ error: NOT_FINISHED_MESSAGE });

  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${OAUTH_HOST}`);
    } catch {
      url = new URL('http://127.0.0.1/');
    }
    if (done || req.method !== 'GET' || url.pathname !== '/callback') {
      res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    let outcome: LoopbackResult;
    let shown: string | null = null;
    if (error !== null) {
      const text = cleanText(url.searchParams.get('error_description') ?? '') || cleanText(error) || NOT_FINISHED_MESSAGE;
      outcome = { error: text };
      shown = `GitHub sign-in did not work: ${text}`;
    } else if (code && code.length <= MAX_CODE_LENGTH) {
      outcome = { code };
    } else {
      outcome = { error: NOT_FINISHED_MESSAGE };
      shown = NOT_FINISHED_MESSAGE;
    }
    res.writeHead(200, { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(shown));
    finish(outcome, res);
  };

  for (const port of ports) {
    server = await listenOn(port, onRequest, onConnection);
    if (server) break;
  }
  if (!server) throw new Error('ports busy');
  const boundPort = (server.address() as AddressInfo).port;
  // A failure after listening (rare) is the end of this attempt, not a crash.
  server.on('error', onAbort);

  timer = setTimeout(onAbort, timeoutMs);
  timer.unref?.();
  if (o.signal?.aborted) onAbort();
  else o.signal?.addEventListener('abort', onAbort, { once: true });

  return {
    redirectTo: `http://${OAUTH_HOST}:${boundPort}/callback`,
    result,
    close: () => finish({ error: NOT_FINISHED_MESSAGE }),
  };
}
