import type { Page } from 'playwright';
import type { AppConfig } from '../config.js';
import type { DomCaption, DomChatMessage, MeetController } from './controller.js';
import { scrapeCaptionInPage, scrapeChatInPage } from './dom.js';
import {
  buttonWantsDeviceOff,
  captionsButtonRank,
  chooseJoinButton,
  isMediaToggle,
} from './prejoin.js';

const LEAVE_SELECTOR = [
  '[aria-label*="Leave call" i]',
  '[aria-label*="Abandonar la llamada" i]',
  '[aria-label*="Salir de la llamada" i]',
].join(', ');

const CHAT_INPUT = [
  'textarea[aria-label*="mensaje" i]',
  'textarea[aria-label*="message" i]',
  '[contenteditable="true"][aria-label*="mensaje" i]',
  '[contenteditable="true"][aria-label*="message" i]',
].join(', ');

export async function createPlaywrightMeet(config: AppConfig): Promise<MeetController> {
  const session = new PlaywrightMeetSession(config);
  await session.launch();
  return session;
}

class PlaywrightMeetSession implements MeetController {
  private context: import('playwright').BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private readonly config: AppConfig) {}

  async beginLogin(): Promise<void> {
    await this.requiredPage().goto('https://accounts.google.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
  }

  async launch(): Promise<void> {
    const { chromium } = await import('playwright');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(this.config.meetProfileDir, { recursive: true });
    try {
      this.context = await chromium.launchPersistentContext(this.config.meetProfileDir, {
        headless: this.config.meetHeadless,
        viewport: { width: 1280, height: 720 },
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires',
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--autoplay-policy=no-user-gesture-required',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      });
    } catch (error) {
      throw explainLaunchError(error);
    }
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
  }

  async join(url: string): Promise<void> {
    const page = this.requiredPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await dismissInterstitials(page);
    await fillGuestName(page, this.config.displayName);
    await muteDevices(page);
    await clickJoin(page);
    await dismissInterstitials(page);
    await waitUntilAdmitted(page, this.config.admissionTimeoutMs);
    await openChat(page);
    await enableCaptions(page, this.config.meetDebug);
  }

  async postMessage(text: string): Promise<void> {
    const page = this.requiredPage();
    await openChat(page);
    const input = page.locator(CHAT_INPUT).first();
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    await input.click();
    try {
      await input.fill(text);
    } catch {
      await page.keyboard.insertText(text);
    }
    const send = page.locator('button[aria-label*="Enviar" i], button[aria-label*="Send" i]').first();
    if (await send.isVisible().catch(() => false)) await send.click();
    else await input.press('Enter');
  }

  async scrapeChat(): Promise<DomChatMessage[]> {
    const page = this.requiredPage();
    return page.evaluate(scrapeChatInPage);
  }

  async scrapeCaption(): Promise<DomCaption | null> {
    const page = this.requiredPage();
    return page.evaluate(scrapeCaptionInPage);
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    this.context = null;
    this.page = null;
  }

  private requiredPage(): Page {
    if (!this.page) throw new Error('El navegador no está abierto.');
    return this.page;
  }
}

async function dismissInterstitials(page: Page): Promise<void> {
  const names = [/entendido/i, /got it/i, /aceptar todo/i, /accept all/i, /continuar sin/i, /continue without/i];
  for (const name of names) {
    const button = page.getByRole('button', { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => undefined);
    }
  }
}

async function fillGuestName(page: Page, displayName: string): Promise<void> {
  const input = page
    .locator(
      'input[aria-label*="nombre" i], input[aria-label*="name" i], input[placeholder*="nombre" i], input[placeholder*="name" i]',
    )
    .first();
  if (await input.isVisible().catch(() => false)) await input.fill(displayName);
}

async function muteDevices(page: Page): Promise<void> {
  const labels = await page.locator('button, [role="button"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label') || ''),
  );
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index] ?? '';
    if (!isMediaToggle(label) || !buttonWantsDeviceOff(label)) continue;
    await page
      .locator('button, [role="button"]')
      .nth(index)
      .click()
      .catch(() => undefined);
  }
}

async function clickJoin(page: Page): Promise<void> {
  const labels = await page.locator('button').evaluateAll((elements) =>
    elements.map((element) => `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.trim()),
  );
  const index = chooseJoinButton(labels);
  if (index < 0) {
    throw new Error('No encontré el botón de unirse. Meet cambió la pantalla o el link no abre la sala.');
  }
  await page.locator('button').nth(index).click();
}

async function waitUntilAdmitted(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const denied = await page
      .getByText(/you can't join|no puedes unirte|denied your request|denegó tu solicitud|se rechazó tu solicitud/i)
      .count()
      .catch(() => 0);
    if (denied > 0) {
      throw new Error('El anfitrión no admitió al asistente o esta reunión no deja entrar.');
    }
    if (await page.locator(LEAVE_SELECTOR).first().isVisible().catch(() => false)) return;
    await page.waitForTimeout(1000);
  }
  throw new Error('Se agotó la espera para que el anfitrión admita al asistente.');
}

async function openChat(page: Page): Promise<void> {
  if (await page.locator(CHAT_INPUT).first().isVisible().catch(() => false)) return;
  const chat = page
    .locator(
      [
        'button[aria-label*="chat con todos" i]',
        'button[aria-label*="chat with everyone" i]',
        'button[aria-label="Chat" i]',
        'button[aria-label*="Chat" i]',
      ].join(', '),
    )
    .first();
  if (await chat.isVisible().catch(() => false)) await chat.click();
  await page.locator(CHAT_INPUT).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
}

async function enableCaptions(page: Page, debug: boolean): Promise<void> {
  try {
    const labels = await page.locator('button').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-label') || element.textContent || ''),
    );
    let bestRank = Number.POSITIVE_INFINITY;
    let bestIndex = -1;
    labels.forEach((label, index) => {
      const rank = captionsButtonRank(label);
      if (rank >= 0 && rank < bestRank) {
        bestRank = rank;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) await page.locator('button').nth(bestIndex).click();
    else if (debug) console.log('[meet] No encontré el botón de subtítulos. La transcripción queda en espera.');
  } catch (error) {
    if (debug) console.log(`[meet] Subtítulos no disponibles: ${error instanceof Error ? error.message : error}`);
  }
}

export async function runGoogleLogin(config: AppConfig): Promise<void> {
  const session = new PlaywrightMeetSession({ ...config, meetHeadless: false });
  try {
    await session.launch();
    await session.beginLogin();
    console.log(`Perfil: ${config.meetProfileDir}`);
    console.log('Iniciá sesión con la cuenta de Google del asistente.');
    console.log('Conviene que el nombre de esa cuenta sea "Asistente IA de Mara": Meet lo usa cuando ya estás logueada.');
    await waitForLoginDone();
  } finally {
    await session.close();
  }
}

function waitForLoginDone(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
    if (process.stdin.isTTY) {
      console.log('Cuando termines el login, presioná Enter.');
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', done);
      return;
    }
    console.log('No hay terminal interactiva. Entrá por VNC y cortá con Ctrl+C cuando la sesión esté iniciada.');
  });
}

function explainLaunchError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/xserver|display|missing x|looks like you launched/i.test(message)) {
    return new Error(
      'No pude abrir Chromium. En una VM sin monitor usá `xvfb-run -a npm run serve`. MEET_HEADLESS=true a veces lo bloquea Meet.',
    );
  }
  return error instanceof Error ? error : new Error(message);
}
