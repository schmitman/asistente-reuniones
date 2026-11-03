import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { renderPanel } from './page.js';
import type { PanelSnapshot } from './snapshot.js';

export interface PanelApi {
  getSnapshot(): PanelSnapshot;
  requestJoin(url: string, consent: boolean): void;
  requestLeave(): Promise<void>;
}

export async function startPanelServer(options: {
  host: string;
  port: number;
  token: string;
  api: PanelApi;
}): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      await route(request, response, options);
    } catch (error) {
      const status = statusOf(error);
      sendJson(response, status, { error: error instanceof Error ? error.message : 'Error interno.' });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  const host = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;
  return {
    port,
    url: `http://${host}:${port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: { token: string; api: PanelApi },
): Promise<void> {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (!authorized(request, options.token, url.pathname)) {
    sendJson(response, 401, { error: 'Falta el token del panel.' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(renderPanel(options.api.getSnapshot(), options.token));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/status') {
    sendJson(response, 200, options.api.getSnapshot());
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/join') {
    const body = await readJson(request);
    const meetUrl = typeof body.url === 'string' ? body.url : '';
    const consent = body.consent === true;
    options.api.requestJoin(meetUrl, consent);
    sendJson(response, 202, { ok: true });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/leave') {
    await options.api.requestLeave();
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { error: 'No existe esa ruta.' });
}

function authorized(request: IncomingMessage, token: string, pathname: string): boolean {
  if (!token || (request.method === 'GET' && pathname === '/')) return true;
  const header = request.headers.authorization || '';
  const alt = request.headers['x-panel-token'];
  const provided = Array.isArray(alt) ? alt[0] : alt;
  return header === `Bearer ${token}` || provided === token;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_000) throw httpError('El pedido es demasiado grande.', 413);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw httpError('El cuerpo tiene que ser un objeto JSON.', 400);
  }
  return parsed as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

export function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function statusOf(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  if (error instanceof SyntaxError) return 400;
  return 500;
}
