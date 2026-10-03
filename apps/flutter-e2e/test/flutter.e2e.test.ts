/**
 * Parcours des deux applications Flutter web dans de vrais navigateurs (Chromium), l'un pour le passager, l'autre pour
 * le chauffeur, contre l'API réelle. Nécessite : l'API (Postgres + Redis, OTP_DEV_FIXED_CODE=123456, premier admin créé par
 * `db:seed`) avec les origines des deux apps dans CORS_ORIGINS, et les deux builds servis :
 *
 *   flutter build web --release --no-web-resources-cdn --dart-define=API_URL=http://localhost:3000/v1   (dans chaque app)
 *   node serve.mjs ../passenger_app/build/web 3101 & node serve.mjs ../driver_app/build/web 3102 &
 *   pnpm flutter-e2e test:e2e
 *
 * Les éléments se trouvent par leur rôle et leur libellé (arbre d'accessibilité de Flutter), comme le ferait un lecteur d'écran.
 * SCREENSHOT_DIR=<dossier> enregistre des captures.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { Redis } from 'ioredis';
import { expect as ui } from '@playwright/test';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL ?? 'http://localhost:3010/v1';
const PASSENGER_APP = process.env.PASSENGER_URL ?? 'http://localhost:3101';
const DRIVER_APP = process.env.DRIVER_URL ?? 'http://localhost:3102';
const SHOTS = process.env.SCREENSHOT_DIR;
const ADMIN_PHONE = '+21620000000';
const OTP = '123456';
const REQUIRED = ['cin', 'driving_license', 'vehicle_registration', 'insurance'];
const WAIT = { timeout: 60_000 };

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const mobile = () => `2${Math.floor(1_000_000 + Math.random() * 8_999_999)}`.replace(/^(\d)/, '2$1').slice(0, 8);

function png(): Buffer {
  const [width, height] = [120, 80];
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height, 120);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Fixtures via l'API : un chauffeur dont le dossier est déjà validé ───

async function call<T = any>(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

async function login(phone: string) {
  await call('POST', '/auth/otp/request', undefined, { phone });
  const { body } = await call('POST', '/auth/otp/verify', undefined, { phone, code: OTP });
  return { token: body.accessToken as string, userId: body.user.id as string };
}

async function createApprovedDriver(phone: string, name: string) {
  const driver = await login(phone);
  await call('PATCH', '/me', driver.token, { fullName: name });
  await call('POST', '/drivers/onboarding', driver.token, { cinNumber: digits(8), licenseNumber: `P${digits(8)}`, licenseExpiry: '2030-01-01' });
  await call('POST', '/drivers/me/vehicles', driver.token, { make: 'Kia', model: 'Picanto', color: 'Blanc', year: 2021, plate: `${digits(3)} تونس ${digits(4)}` });
  for (const type of REQUIRED) {
    const form = new FormData();
    form.set('type', type);
    if (type === 'insurance') form.set('expiresAt', '2030-01-01');
    form.set('file', new Blob([new Uint8Array(png())]), 'scan.png');
    const res = await fetch(`${API}/drivers/me/documents`, { method: 'POST', headers: { authorization: `Bearer ${driver.token}` }, body: form });
    expect(res.status).toBe(201);
  }
  const admin = await login(ADMIN_PHONE);
  const docs = (await call('GET', `/admin/drivers/${driver.userId}`, admin.token)).body.documents as { id: string }[];
  for (const doc of docs) await call('POST', `/admin/drivers/${driver.userId}/documents/${doc.id}/approve`, admin.token);
  expect((await call('POST', `/admin/drivers/${driver.userId}/approve`, admin.token)).status).toBe(200);
  return driver;
}

// ─── Aides de pilotage ───

/**
 * Saisie comme au clavier : Flutter ne crée le vrai champ de saisie qu'au clic, et `fill()` peut écrire avant qu'il existe
 * (la valeur est alors perdue). On clique, on efface (Ctrl+A n'est pas pris en compte), on tape, et on attend que le champ affiche la valeur.
 */
async function enter(page: Page, name: string | RegExp, value: string) {
  const box = page.getByRole('textbox', { name });
  await box.click();
  await page.keyboard.press('End');
  for (let i = (await box.inputValue()).length; i > 0; i--) await page.keyboard.press('Backspace');
  await page.keyboard.type(value, { delay: 25 });
  await ui(box).toHaveValue(value, { timeout: 5_000 });
}

/** Connexion par code SMS, comme un utilisateur. */
async function signIn(page: Page, phone: string) {
  await enter(page, 'Numéro de téléphone', phone);
  await page.getByRole('button', { name: 'Recevoir le code' }).click();
  await enter(page, /Code à 6 chiffres/, OTP);
  await page.getByRole('button', { name: 'Valider' }).click();
}

/** En cas d'échec, affiche ce que la page montre réellement (arbre d'accessibilité) pour comprendre sans deviner. */
const shows = async (page: Page, text: string | RegExp) => {
  try {
    await ui(page.getByText(text).first()).toBeVisible(WAIT);
  } catch (e) {
    console.log(`Texte introuvable : ${text}
${await page.locator('body').ariaSnapshot().catch(() => '(page illisible)')}`);
    throw e;
  }
};

describe('apps Flutter : passager et chauffeur', () => {
  let browser: Browser;
  let passenger: Page;
  let driver: Page;
  let driverApi: Awaited<ReturnType<typeof login>>;
  const driverTrace: string[] = [];
  const driverPhone = mobile();
  const passengerPhone = mobile();
  const driverName = `Sami ${digits(4)}`;

  const shot = async (page: Page, name: string) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  };

  beforeAll(async () => {
    // Remet à zéro les limites d'envoi d'OTP : les numéros de test servent d'abord aux fixtures, puis à l'interface
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');
    const clear = async () => {
      const keys = [...(await redis.keys('otp:cooldown:*')), ...(await redis.keys('otp:rl:*'))];
      if (keys.length) await redis.del(...keys);
    };
    await clear();
    driverApi = await createApprovedDriver(`+216${driverPhone}`, driverName);
    await clear();
    await redis.quit();

    browser = await chromium.launch();
    const viewport = { width: 460, height: 900 };
    passenger = await (await browser.newContext({ viewport })).newPage();
    driver = await (await browser.newContext({ viewport })).newPage();
    // Trace du navigateur chauffeur, affichée si une attente échoue
    driver.on('websocket', (ws) => {
      ws.on('framereceived', (f) => driverTrace.push(`<- ${String(f.payload).slice(0, 200)}`));
      ws.on('close', () => driverTrace.push('WS fermé'));
    });
    driver.on('console', (m) => driverTrace.push(`console ${m.type()} ${m.text().slice(0, 300)}`));
    driver.on('pageerror', (e) => driverTrace.push(`pageerror ${e.message.slice(0, 200)}`));
    await Promise.all([passenger.goto(PASSENGER_APP), driver.goto(DRIVER_APP)]);
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('refuse un numéro invalide avec un message en français', async () => {
    await enter(passenger, 'Numéro de téléphone', '12345');
    await passenger.getByRole('button', { name: 'Recevoir le code' }).click();
    await shows(passenger, 'Numéro de téléphone invalide.');
    await shot(passenger, '01-passager-connexion');
  });

  it('le chauffeur se connecte et se met en ligne', async () => {
    await signIn(driver, driverPhone);
    await shows(driver, 'Hors ligne');
    await shot(driver, '02-chauffeur-accueil');
    await driver.getByRole('button', { name: 'Se mettre en ligne' }).click();
    await shows(driver, 'En ligne');
  });

  it('le passager se connecte, choisit une destination et voit un prix garanti', async () => {
    await signIn(passenger, passengerPhone);
    await shows(passenger, 'Où allez-vous ?');
    await passenger.getByRole('button', { name: /Arrivée/ }).click();
    await enter(passenger, 'Rechercher une adresse', 'La Marsa');
    await passenger.getByRole('button', { name: /La Marsa/ }).first().click();
    await passenger.getByRole('button', { name: 'Voir le prix' }).click();
    await shows(passenger, 'Prix garanti');
    await shows(passenger, /\d+,\d{3} DT/);
    await shot(passenger, '03-passager-prix');
  });

  it("la course est proposée au chauffeur, qui l'accepte", async () => {
    await passenger.getByRole('button', { name: 'Commander' }).click();
    await shows(passenger, "Recherche d'un chauffeur…");

    try {
      await ui(driver.getByRole('button', { name: 'Accepter' })).toBeVisible(WAIT);
    } catch (e) {
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');
      console.log('Etat serveur du chauffeur', Date.now(), await redis.hgetall(`driver:state:${driverApi.userId}`));
      console.log('Index geo', await redis.geopos('geo:drivers:standard', driverApi.userId), 'taille', await redis.zcard('geo:drivers:standard'));
      console.log('Trace chauffeur :', driverTrace.filter((l) => !/^(<- 2|console (debug|warning))/.test(l)));
      await redis.quit();
      throw e;
    }
    await shot(driver, '04-chauffeur-offre');
    await driver.getByRole('button', { name: 'Accepter' }).click();
    await shows(driver, 'Votre chauffeur arrive');

    // Le passager voit son chauffeur, son véhicule et sa plaque
    await shows(passenger, 'Votre chauffeur arrive');
    await shows(passenger, new RegExp(driverName));
    await shows(passenger, /Kia Picanto/);
    await shot(passenger, '05-passager-chauffeur');
  });

  it('chaque étape du chauffeur apparaît chez le passager', async () => {
    await driver.getByRole('button', { name: 'Je suis arrivé' }).click();
    await shows(passenger, 'Votre chauffeur est arrivé');

    await driver.getByRole('button', { name: 'Démarrer la course' }).click();
    await shows(passenger, 'Course en cours');
    await shot(passenger, '06-passager-en-course');

    await driver.getByRole('button', { name: 'Terminer la course' }).click();
    await shows(passenger, 'Course terminée');
    await shows(passenger, 'Payez le chauffeur en espèces');
    await shot(passenger, '07-passager-fin');
  });

  it("le chauffeur encaisse en espèces, le passager note, la commission figure au portefeuille", async () => {
    await driver.getByRole('button', { name: /Encaisser .* en espèces/ }).click();
    await shows(driver, 'Espèces encaissées');

    await passenger.getByRole('button', { name: '5', exact: true }).click();
    await passenger.getByRole('button', { name: 'Envoyer ma note' }).click();
    await shows(passenger, 'Merci pour votre avis !');

    await driver.getByRole('button', { name: 'Fermer' }).click();
    await driver.getByRole('tab', { name: 'Portefeuille' }).click();
    await shows(driver, 'Dette envers la plateforme');
    const wallet = (await call('GET', '/drivers/me/wallet', driverApi.token)).body;
    expect(wallet.debt).toBeGreaterThan(0);
    const debt = `${Math.floor(wallet.debt / 1000)},${String(wallet.debt % 1000).padStart(3, '0')} DT`;
    await shows(driver, debt);
    await shot(driver, '08-chauffeur-portefeuille');

    // L'historique du passager contient la course terminée
    await passenger.getByRole('button', { name: 'Nouvelle course' }).click();
    await passenger.getByRole('button', { name: 'Mes courses' }).click();
    await shows(passenger, 'Course terminée');
  });

  it("l'arabe s'affiche de droite à gauche et se mémorise", async () => {
    await passenger.getByRole('button', { name: /Retour|Back/ }).click();
    await passenger.getByRole('button', { name: 'العربية' }).click();
    await shows(passenger, 'رحلاتي');
    await shot(passenger, '09-passager-arabe');
    // La langue survit à un rechargement
    await passenger.reload();
    await ui(passenger.getByRole('button', { name: 'Français' })).toBeVisible(WAIT);
  });

  it('la déconnexion ramène à la connexion', async () => {
    await driver.getByRole('button', { name: 'Se déconnecter' }).click();
    await ui(driver.getByRole('button', { name: 'Recevoir le code' })).toBeVisible(WAIT);
  });
});
