// Real sockets on the real ports (53682–53684): the tests in this file run one after the other, and every test closes
// what it opened. Requests use node:http without an agent, so no connection is kept between tests.
import { createServer, get, type Server } from 'node:http';
import { NOT_FINISHED_MESSAGE, OAUTH_PORTS, OAUTH_TIMEOUT_MS, openLoopback } from '../../src/main/social/oauth-loopback';

type Opened = Awaited<ReturnType<typeof openLoopback>>;

const opened: Opened[] = [];
const blockers: Server[] = [];

async function open(o?: Parameters<typeof openLoopback>[0]): Promise<Opened> {
  const l = await openLoopback(o);
  opened.push(l);
  return l;
}

/** Another app holding a port on 127.0.0.1. */
function block(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer((_req, res) => res.end('other app'));
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
    blockers.push(s);
  });
}

const closeServer = (s: Server) =>
  new Promise<void>((resolve) => {
    s.closeAllConnections();
    s.close(() => resolve());
  });

afterEach(async () => {
  for (const l of opened.splice(0)) {
    l.close();
    await l.result;
  }
  await Promise.all(blockers.splice(0).filter((s) => s.listening).map(closeServer));
});

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function request(url: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = get(url, { agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function refused(url: string): Promise<string> {
  try {
    await request(url);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code ?? 'error';
  }
  return 'answered';
}

/** True when nothing listens on the port any more (we can take it ourselves). */
async function isFree(port: number): Promise<boolean> {
  try {
    const s = await block(port);
    await closeServer(s);
    return true;
  } catch {
    return false;
  }
}

test('the ports and the timeout are the agreed ones', () => {
  expect(OAUTH_PORTS).toEqual([53682, 53683, 53684]);
  expect(OAUTH_TIMEOUT_MS).toBe(300_000);
});

test('listens on 53682 when it is free', async () => {
  const l = await open();
  expect(l.redirectTo).toBe('http://127.0.0.1:53682/callback');
});

test('takes 53683 when another app holds 53682, and 53684 after that', async () => {
  await block(53682);
  expect((await open()).redirectTo).toBe('http://127.0.0.1:53683/callback');
  expect((await open()).redirectTo).toBe('http://127.0.0.1:53684/callback');
});

test('refuses with "ports busy" when all three ports are taken', async () => {
  await block(53682);
  await block(53683);
  await block(53684);
  await expect(openLoopback()).rejects.toThrow('ports busy');
});

test('a callback with a code ends the wait with the code and a small page that says to go back', async () => {
  const l = await open();
  const answer = await request('http://127.0.0.1:53682/callback?code=abc');
  expect(await l.result).toEqual({ code: 'abc' });
  expect(answer.status).toBe(200);
  expect(answer.headers['content-type']).toBe('text/html; charset=utf-8');
  expect(answer.headers['cache-control']).toBe('no-store');
  expect(answer.body).toContain('You can go back to DevTalk.');
  // Nothing outside the page: no scripts, styles, images or links to fetch.
  expect(answer.body).not.toMatch(/<script|<link|<img|src=|href=/i);
  expect(answer.body.length).toBeLessThan(2000);
});

test('a callback with an error ends the wait with the error and shows it as plain text', async () => {
  const l = await open();
  const answer = await request('http://127.0.0.1:53682/callback?error=access_denied&error_description=The+user+said+no');
  expect(await l.result).toEqual({ error: 'The user said no' });
  expect(answer.status).toBe(200);
  expect(answer.body).toContain('The user said no');
  expect(answer.body).toContain('You can go back to DevTalk.');
});

test('error text is escaped: a made-up error cannot put markup on the page', async () => {
  const l = await open();
  const evil = encodeURIComponent('<script>alert(1)</script><img src=x onerror=alert(2)>"&\'');
  const answer = await request(`http://127.0.0.1:53682/callback?error=x&error_description=${evil}`);
  expect('error' in (await l.result)).toBe(true);
  expect(answer.body).not.toContain('<script>alert');
  expect(answer.body).not.toContain('<img');
  expect(answer.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(answer.body).toContain('&quot;&amp;&#39;');
});

test('a callback with neither code nor error ends the wait as not finished', async () => {
  const l = await open();
  await request('http://127.0.0.1:53682/callback');
  expect(await l.result).toEqual({ error: NOT_FINISHED_MESSAGE });
});

test('other paths get 404 and the wait goes on', async () => {
  const l = await open();
  for (const path of ['/other', '/', '/favicon.ico', '/callback/extra', '/CALLBACK?code=nope']) {
    const answer = await request(`http://127.0.0.1:53682${path}`);
    expect(answer.status).toBe(404);
    expect(answer.headers['cache-control']).toBe('no-store');
  }
  let settled = false;
  void l.result.then(() => (settled = true));
  await new Promise((r) => setTimeout(r, 20));
  expect(settled).toBe(false);
  await request('http://127.0.0.1:53682/callback?code=abc');
  expect(await l.result).toEqual({ code: 'abc' });
});

test('after the first callback the listener is closed: a second callback is refused', async () => {
  const l = await open();
  await request('http://127.0.0.1:53682/callback?code=first');
  expect(await l.result).toEqual({ code: 'first' });
  expect(await refused('http://127.0.0.1:53682/callback?code=second')).toBe('ECONNREFUSED');
  expect(await isFree(53682)).toBe(true);
});

test('a made-up error first still ends the wait once; a real code after it is refused', async () => {
  const l = await open();
  await request('http://127.0.0.1:53682/callback?error=forged');
  expect(await l.result).toEqual({ error: 'forged' });
  expect(await refused('http://127.0.0.1:53682/callback?code=real')).toBe('ECONNREFUSED');
});

test('the timeout ends the wait as not finished and frees the port', async () => {
  const l = await open({ timeoutMs: 50 });
  expect(await l.result).toEqual({ error: NOT_FINISHED_MESSAGE });
  expect(await isFree(53682)).toBe(true);
  // A new attempt works.
  expect((await open()).redirectTo).toBe('http://127.0.0.1:53682/callback');
});

test('abort (Cancel) ends the wait as not finished and frees the port', async () => {
  const ac = new AbortController();
  const l = await open({ signal: ac.signal });
  ac.abort();
  expect(await l.result).toEqual({ error: NOT_FINISHED_MESSAGE });
  expect(await isFree(53682)).toBe(true);
});

test('a signal that is already aborted ends the wait at once', async () => {
  const ac = new AbortController();
  ac.abort();
  const l = await open({ signal: ac.signal });
  expect(await l.result).toEqual({ error: NOT_FINISHED_MESSAGE });
  expect(await isFree(53682)).toBe(true);
});

test('close() while waiting ends the wait as not finished; close() twice is harmless', async () => {
  const l = await open();
  l.close();
  l.close();
  expect(await l.result).toEqual({ error: NOT_FINISHED_MESSAGE });
  expect(await isFree(53682)).toBe(true);
});

test('close() also drops an idle connection a browser kept open', async () => {
  const l = await open();
  // A connection that sends nothing (a browser preconnect) must not keep the port.
  const { connect } = await import('node:net');
  const idle = connect(53682, '127.0.0.1');
  await new Promise((r) => idle.once('connect', r));
  l.close();
  expect(await l.result).toEqual({ error: NOT_FINISHED_MESSAGE });
  expect(await isFree(53682)).toBe(true);
  idle.destroy();
});

test('binds 127.0.0.1 only: other addresses of this machine cannot reach it', async () => {
  const l = await open();
  expect(l.redirectTo.startsWith('http://127.0.0.1:')).toBe(true);
  // 127.0.0.2 is also this machine (Linux answers the whole 127/8) but not the address we listen on.
  expect(await refused('http://127.0.0.2:53682/callback?code=x')).not.toBe('answered');
  expect(await refused('http://[::1]:53682/callback?code=x')).not.toBe('answered');
  let settled = false;
  void l.result.then(() => (settled = true));
  await new Promise((r) => setTimeout(r, 20));
  expect(settled).toBe(false);
});

test('a chosen list of ports is used in order (port 0 = any free port)', async () => {
  const l = await open({ ports: [0] });
  expect(l.redirectTo).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  expect(l.redirectTo).not.toContain(':0/');
  const answer = await request(`${l.redirectTo}?code=zzz`);
  expect(answer.status).toBe(200);
  expect(await l.result).toEqual({ code: 'zzz' });
});
