/**
 * Parcours du back-office dans un vrai navigateur (Chromium). Nécessite : l'API démarrée avec Postgres + Redis
 * (config par défaut, OTP_DEV_FIXED_CODE=123456, premier admin créé par `db:seed`) et le back-office lancé.
 *
 *   ADMIN_URL=http://localhost:3001 API_URL=http://localhost:3000/v1 pnpm admin test:e2e
 *
 * SCREENSHOT_DIR=<dossier> enregistre des captures de chaque écran, en français et en arabe.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { Redis } from 'ioredis';
import { expect as ui } from '@playwright/test';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001';
const API = process.env.API_URL ?? 'http://localhost:3000/v1';
const SHOTS = process.env.SCREENSHOT_DIR;
const ADMIN_PHONE = '+21620000000';
const OTP = '123456';
const REQUIRED = ['cin', 'driving_license', 'vehicle_registration', 'insurance'];

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const mobile = () => `+2162${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

/** PNG valide (dégradé) : les aperçus de documents affichent quelque chose de reconnaissable. */
function png(width = 360, height = 220): Buffer {
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
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RVB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      rows[o] = 40 + Math.round((x / width) * 120);
      rows[o + 1] = 110 + Math.round((y / height) * 90);
      rows[o + 2] = 150;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Fixtures via l'API (ce que feraient l'app chauffeur et l'app passager) ───

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

async function uploadDocument(token: string, type: string) {
  const form = new FormData();
  form.set('type', type);
  if (type === 'insurance') form.set('expiresAt', '2030-01-01');
  form.set('file', new Blob([new Uint8Array(png())]), 'scan.png');
  const res = await fetch(`${API}/drivers/me/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  expect(res.status).toBe(201);
}

async function createDriverWithFullDossier(name: string) {
  const driver = await login(mobile());
  await call('PATCH', '/me', driver.token, { fullName: name });
  await call('POST', '/drivers/onboarding', driver.token, {
    cinNumber: digits(8),
    licenseNumber: `P${digits(8)}`,
    licenseExpiry: '2030-01-01',
  });
  await call('POST', '/drivers/me/vehicles', driver.token, {
    make: 'Kia',
    model: 'Picanto',
    color: 'Blanc',
    year: 2021,
    plate: `${digits(3)} تونس ${digits(4)}`,
  });
  for (const type of REQUIRED) await uploadDocument(driver.token, type);
  return driver;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** `expect.poll` attend 1 s par défaut : trop court quand la page recharge ses scans après une action. */
const poll = <T>(fn: () => Promise<T> | T) => expect.poll(fn, { timeout: 15_000, interval: 100 });
const PICKUP = { lat: 36.8008, lng: 10.18 };
const LA_MARSA = { lat: 36.8782, lng: 10.3247 };

/** Course complète : devis, offre, acceptation, trace GPS, fin, encaissement cash et notes. Renvoie l'id de la course. */
async function runCompletedTrip(driver: { token: string }, passenger: { token: string }) {
  expect((await call('POST', '/drivers/me/availability', driver.token, { online: true })).status).toBe(200);
  await call('POST', '/drivers/me/location', driver.token, { points: [{ lat: 36.8065, lng: 10.1815, ts: Date.now() }] });

  const quote = await call('POST', '/trips/estimate', passenger.token, {
    pickup: PICKUP,
    dropoff: LA_MARSA,
    pickupAddress: 'Avenue Habib Bourguiba, Tunis',
    dropoffAddress: 'La Marsa',
  });
  const trip = await call('POST', '/trips', passenger.token, { quoteId: quote.body.quoteId });
  const id = trip.body.id as string;

  // L'offre part du worker de façon asynchrone, et un chauffeur resté « en ligne » d'une exécution précédente peut la recevoir
  // avant (15 s de délai par offre, MATCHING_OFFER_TIMEOUT_S) : on réessaie jusqu'à ce qu'elle soit acceptable.
  let accepted = 0;
  for (let attempt = 0; attempt < 150 && accepted !== 200; attempt++) {
    accepted = (await call('POST', `/trips/${id}/accept`, driver.token)).status;
    if (accepted !== 200) await sleep(300);
  }
  expect(accepted).toBe(200);

  const t0 = Date.now();
  await call('POST', '/drivers/me/location', driver.token, {
    points: [0, 1, 2, 3].map((i) => ({ lat: PICKUP.lat + i * 0.01, lng: PICKUP.lng + i * 0.02, ts: t0 + i * 1_000 })),
  });
  // Position de départ proche du point de prise en charge pour pouvoir signaler l'arrivée
  await call('POST', '/drivers/me/location', driver.token, { points: [{ ...PICKUP, ts: t0 + 10_000 }] });
  expect((await call('POST', `/trips/${id}/arrived`, driver.token)).status).toBe(200);
  expect((await call('POST', `/trips/${id}/start`, driver.token)).status).toBe(200);
  expect((await call('POST', `/trips/${id}/complete`, driver.token)).status).toBe(200);
  await call('POST', `/trips/${id}/cash-collected`, driver.token);
  await call('POST', `/trips/${id}/rating`, passenger.token, { score: 5, comment: 'Trajet impeccable' });
  await call('POST', `/trips/${id}/rating`, driver.token, { score: 4 });
  return id;
}

describe('back-office admin', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let driver: Awaited<ReturnType<typeof login>>;
  // Lu dans les cookies de la session navigateur : pas de second code OTP pour l'admin (délai de 60 s entre deux envois)
  let adminToken = '';
  let adminUserId = '';
  const driverName = `Sami ${digits(4)}`;

  const shot = async (name: string) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  };
  const here = () => new URL(page.url()).pathname;

  beforeAll(async () => {
    // Remet à zéro les limites d'envoi d'OTP (le numéro admin est réutilisé à chaque exécution)
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');
    const keys = [...(await redis.keys('otp:cooldown:*')), ...(await redis.keys('otp:rl:*'))];
    if (keys.length) await redis.del(...keys);
    await redis.quit();

    driver = await createDriverWithFullDossier(driverName);
    browser = await chromium.launch();
    context = await browser.newContext({ baseURL: ADMIN, viewport: { width: 1200, height: 900 } });
    page = await context.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('renvoie vers la connexion sans session, y compris pour les fichiers', async () => {
    await page.goto('/drivers');
    expect(here()).toBe('/login');
    await shot('01-login-fr');

    // Même une URL de scan du back-office exige la session
    const anonymous = await browser.newContext({ baseURL: ADMIN });
    const open = await anonymous.request.get(`/drivers/${driver.userId}/documents/${driver.userId}/open`, { maxRedirects: 0 });
    expect(open.status()).toBe(307);
    expect(new URL(open.headers().location!, ADMIN).pathname).toBe('/login');
    await anonymous.close();
  });

  it("refuse un compte qui n'est pas administrateur, sans ouvrir de session", async () => {
    const phone = mobile();
    await page.goto('/login');
    await page.getByLabel('Numéro de téléphone').fill(phone);
    await page.getByRole('button', { name: 'Recevoir le code' }).click();
    await page.getByLabel('Code reçu par SMS').fill(OTP);
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await poll(() => page.locator('p[role="alert"]').textContent()).toContain('n’a pas accès au back-office');
    expect(here()).toBe('/login');
    expect((await context.cookies()).map((c) => c.name)).not.toContain('vtc_at');
  });

  it('connecte un administrateur : mauvais code refusé, puis bon code, cookies httpOnly', async () => {
    await page.goto('/login');
    await page.getByLabel('Numéro de téléphone').fill(ADMIN_PHONE);
    await page.getByRole('button', { name: 'Recevoir le code' }).click();

    // L'erreur de l'API est traduite, jamais affichée telle quelle
    await page.getByLabel('Code reçu par SMS').fill('000000');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await poll(() => page.locator('p[role="alert"]').textContent()).toContain('Code incorrect');

    await page.getByLabel('Code reçu par SMS').fill(OTP);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await page.getByRole('heading', { name: 'Tableau de bord', level: 1 }).waitFor();

    const cookies = await context.cookies();
    for (const name of ['vtc_at', 'vtc_rt']) {
      expect(cookies.find((c) => c.name === name), name).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
    }
    adminToken = cookies.find((c) => c.name === 'vtc_at')!.value;
    adminUserId = JSON.parse(Buffer.from(adminToken.split('.')[1]!, 'base64url').toString()).sub;
    // Aucun jeton accessible au JavaScript de la page
    expect(await page.evaluate(() => document.cookie)).not.toContain('vtc_');
  });

  it("liste le dossier complet dans la file de validation, puis ouvre la fiche", async () => {
    await page.goto('/drivers');
    await shot('02-drivers-fr');
    await page.getByRole('link', { name: driverName }).click();
    await page.getByRole('heading', { name: driverName, level: 1 }).waitFor();
    // Les scans sont de vraies images chargées (et mises à l'échelle), pas des cadres vides
    await page.waitForFunction(() => document.images.length === 4 && [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    await shot('03-driver-fr');

    await ui(page.getByText('À examiner').first()).toBeVisible();
    for (const label of ['Carte d’identité (CIN)', 'Permis de conduire', 'Carte grise', 'Assurance']) {
      await ui(page.getByText(label, { exact: true })).toBeVisible();
    }
    // Numéros masqués : on ne voit que les 3 derniers chiffres
    await ui(page.getByText(/^\*{5}\d{3}$/)).toBeVisible();
    // Tant que les pièces ne sont pas approuvées, la validation du chauffeur est impossible
    await ui(page.getByRole('button', { name: 'Valider le chauffeur' })).toBeDisabled();
    await ui(page.getByText(/À valider avant d’approuver le chauffeur/)).toBeVisible();
  });

  it("charge les scans par liens signés, directement depuis l'API", async () => {
    await page.goto(`/drivers/${driver.userId}`);
    const sources = await page.locator('img').evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
    expect(sources).toHaveLength(REQUIRED.length);
    for (const source of sources) {
      const url = new URL(source);
      // Les images ne passent plus par le serveur du back-office : elles viennent de l'API, avec échéance, admin et signature
      expect(url.origin).toBe(new URL(API).origin);
      expect(url.pathname).toMatch(/^\/v1\/documents\/[0-9a-f-]{36}\/file$/);
      for (const param of ['e', 'a', 's']) expect(url.searchParams.get(param), param).toBeTruthy();
    }

    // Le lien est une capacité : il fonctionne sans cookie ni jeton, n'est pas mis en cache, et ne vaut que pour lui-même
    const anonymous = await browser.newContext();
    const ok = await anonymous.request.get(sources[0]!);
    expect(ok.status()).toBe(200);
    expect(ok.headers()['content-type']).toBe('image/png');
    expect(ok.headers()['cache-control']).toContain('no-store');
    expect(Buffer.from(await ok.body()).subarray(0, 4).toString('hex')).toBe('89504e47');
    const tampered = sources[0]!.replace(/s=([\w-]+)/, (_, sig: string) => `s=${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`);
    expect((await anonymous.request.get(tampered)).status()).toBe(403);
    await anonymous.close();

    // « Ouvrir dans un nouvel onglet » émet un lien neuf (celui de la page a pu expirer) puis y redirige
    const docs = (await call('GET', '/drivers/me/documents', driver.token)).body as { id: string }[];
    const open = await context.request.get(`/drivers/${driver.userId}/documents/${docs[0]!.id}/open`, { maxRedirects: 0 });
    expect(open.status()).toBe(307);
    const target = open.headers().location!;
    expect(new URL(target).origin).toBe(new URL(API).origin);
    expect((await fetch(target)).status).toBe(200);

    // Paramètres mal formés ou document d'un autre chauffeur : refusés sans exposer de fichier
    expect((await context.request.get(`/drivers/${driver.userId}/documents/not-a-uuid/open`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await context.request.get(`/drivers/${adminUserId}/documents/${docs[0]!.id}/open`, { maxRedirects: 0 })).status()).toBe(404);
    // L'ancienne route de relais n'existe plus
    expect((await context.request.get(`/api/files/${driver.userId}/${docs[0]!.id}`)).status()).toBe(404);
  });

  it('refuse un document avec un motif : le dossier retourne au chauffeur', async () => {
    const card = page.locator('section', { has: page.getByText('Carte d’identité (CIN)', { exact: true }) });
    await card.locator('summary').click();
    await card.getByLabel('Motif').fill('Photo floue');
    await card.getByRole('button', { name: 'Refuser' }).click();

    await ui(page.getByRole('status')).toContainText('Document refusé');
    await ui(card.getByText('Motif du refus : Photo floue')).toBeVisible();
    await ui(page.getByText('Documents à fournir').first()).toBeVisible();
    await shot('04-document-refused-fr');
    expect((await call('GET', '/drivers/me', driver.token)).body.status).toBe('pending_documents');
  });

  it('valide le dossier une fois toutes les pièces approuvées', async () => {
    // Le chauffeur renvoie une CIN lisible (côté app chauffeur)
    await uploadDocument(driver.token, 'cin');
    await page.reload();

    const approve = page.getByRole('button', { name: 'Approuver' });
    for (let pending = await approve.count(); pending > 0; pending = await approve.count()) {
      await approve.first().click();
      await poll(() => approve.count()).toBeLessThan(pending);
    }

    const validate = page.getByRole('button', { name: 'Valider le chauffeur' });
    await ui(validate).toBeEnabled();
    await shot('05-ready-to-approve-fr');
    await validate.click();

    await ui(page.getByRole('status')).toContainText('Chauffeur validé');
    await ui(page.getByText('Ce dossier a déjà été traité.')).toBeVisible();
    await shot('06-driver-approved-fr');
    expect((await call('GET', '/drivers/me', driver.token)).body.status).toBe('approved');

    await page.goto('/drivers');
    await ui(page.getByRole('link', { name: driverName })).toHaveCount(0);
  });

  it('gère les signalements : filtre, changement de statut, pagination', async () => {
    const passenger = await login(mobile());
    const description = `Le chauffeur a pris un autre itinéraire ${digits(6)}`;
    const ticket = await call('POST', '/support/tickets', passenger.token, { category: 'incident', description });
    expect(ticket.status).toBe(201);

    await page.goto('/tickets');
    const row = page.getByRole('row', { name: new RegExp(description) });
    await ui(row).toBeVisible();
    await ui(row.getByText('Ouvert', { exact: true }).first()).toBeVisible();
    await shot('07-tickets-fr');

    await row.getByRole('combobox').selectOption('in_progress');
    await row.getByRole('button', { name: 'Enregistrer' }).click();
    await ui(page.getByRole('status')).toContainText('Signalement mis à jour');
    await ui(page.getByRole('row', { name: new RegExp(description) }).getByText('En cours').first()).toBeVisible();

    // Filtre par statut
    await page.getByRole('link', { name: 'Résolu', exact: true }).click();
    await ui(page.getByRole('row', { name: new RegExp(description) })).toHaveCount(0);
    await page.getByRole('link', { name: 'En cours', exact: true }).click();
    await ui(page.getByRole('row', { name: new RegExp(description) })).toBeVisible();

    // Le passager voit la mise à jour côté API
    const mine = (await call('GET', '/support/tickets', passenger.token)).body as { id: string; status: string }[];
    expect(mine.find((t) => t.id === ticket.body.id)?.status).toBe('in_progress');
  });

  it("n'accepte pas une redirection vers un site externe depuis le formulaire des signalements", async () => {
    await page.goto('/tickets');
    const form = page.locator('form', { has: page.locator('input[name="returnTo"]') }).first();
    await form.locator('input[name="returnTo"]').evaluate((el) => ((el as HTMLInputElement).value = 'https://evil.example/'));
    await form.getByRole('button', { name: 'Enregistrer' }).click();
    await page.waitForURL('**/tickets*');
    expect(new URL(page.url()).origin).toBe(new URL(ADMIN).origin);
  });

  describe('exploitation', () => {
    let tripId: string;
    const passengerName = `Amira ${digits(4)}`;

    beforeAll(async () => {
      const passenger = await login(mobile());
      await call('PATCH', '/me', passenger.token, { fullName: passengerName });
      tripId = await runCompletedTrip(driver, passenger);
    });

    it('tableau de bord : activité en direct, indicateurs et graphiques accessibles', async () => {
      await page.goto('/');
      await page.getByRole('heading', { name: 'Tableau de bord', level: 1 }).waitFor();
      for (const label of ['Courses en cours', 'Chauffeurs disponibles', 'Dossiers à valider', 'Signalements ouverts', 'Courses terminées', 'Commission estimée']) {
        await ui(page.getByText(label, { exact: true }).first()).toBeVisible();
      }
      await ui(page.getByText(/sur \d+ demandées/)).toBeVisible();
      await ui(page.getByRole('link', { name: 'Tableau de bord' })).toHaveAttribute('aria-current', 'page');

      // Deux graphiques d'une seule série, 7 jours : une zone de survol par jour
      const charts = page.locator('svg[role="group"]');
      await ui(charts).toHaveCount(2);
      await ui(charts.first().locator('rect[fill="transparent"]')).toHaveCount(7);

      // Survol de « aujourd'hui » : l'infobulle donne le détail du jour
      const box = (await charts.first().boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.93, box.y + box.height * 0.5);
      await ui(page.getByText('Terminées', { exact: true }).first()).toBeVisible();
      await ui(page.getByText('Demandées', { exact: true }).first()).toBeVisible();
      await shot('11-dashboard-fr');

      // Même information au clavier : flèches / fin
      await page.mouse.move(0, 0);
      await charts.nth(1).focus();
      await page.keyboard.press('End');
      await ui(page.getByText("Chiffre d’affaires", { exact: true }).first()).toBeVisible();
      await page.keyboard.press('Escape');

      // Alternative en tableau, tous les jours, sans survol
      await page.getByText('Afficher les données en tableau').click();
      await ui(page.getByRole('row')).toHaveCount(8); // en-tête + 7 jours

      await page.getByRole('link', { name: '30 derniers jours' }).click();
      await ui(page.locator('svg[role="group"]').first().locator('rect[fill="transparent"]')).toHaveCount(30);
    });

    it('courses : liste filtrable puis fiche complète avec carte et trace GPS', async () => {
      await page.goto('/trips');
      const row = page.getByRole('row').filter({ hasText: passengerName });
      await ui(row).toBeVisible();
      await ui(row.getByText('Terminée')).toBeVisible();
      await ui(row.getByText('La Marsa')).toBeVisible();
      await shot('12-trips-fr');

      await page.getByRole('link', { name: 'En cours', exact: true }).click();
      await ui(page.getByRole('row').filter({ hasText: passengerName })).toHaveCount(0);
      await page.getByRole('link', { name: 'Terminée', exact: true }).click();
      await ui(page.getByRole('row').filter({ hasText: passengerName })).toBeVisible();

      await page.getByRole('row').filter({ hasText: passengerName }).getByRole('link').click();
      await page.getByRole('heading', { level: 1, name: `Course ${tripId.slice(0, 8)}` }).waitFor();

      await ui(page.getByText('Espèces · Encaissé')).toBeVisible();
      await ui(page.getByText('Trajet impeccable')).toBeVisible();
      // Historique complet des statuts, dans l'ordre
      const timeline = page.locator('ol li p.font-medium');
      await ui(timeline).toHaveText(['Recherche d’un chauffeur', 'Chauffeur en route', 'Chauffeur arrivé', 'En course', 'Terminée']);
      await ui(page.getByText('Acceptée', { exact: true })).toBeVisible();

      // Carte : conteneur Leaflet monté, avec la trace du chauffeur et les deux repères
      await ui(page.locator('.leaflet-container')).toBeVisible();
      await ui(page.locator('.leaflet-overlay-pane path.leaflet-interactive')).toHaveCount(3);
      await ui(page.getByText(/Distance parcourue : \d/)).toBeVisible();
      await shot('13-trip-fr');

      await page.goto('/trips/00000000-0000-4000-8000-000000000000');
      await ui(page.getByText('Élément introuvable.')).toBeVisible();
    });

    it('tarification : saisie en dinars, erreurs de saisie refusées, effet sur les nouveaux devis, restauré ensuite', async () => {
      const rules = (await call('GET', '/admin/pricing/rules', adminToken)).body as any[];
      const standard = rules.find((r) => r.category === 'standard' && r.zone === null);
      const original = (standard.baseFare / 1000).toFixed(3);

      await page.goto('/pricing');
      const form = page.locator('form', { has: page.locator(`input[name="id"][value="${standard.id}"]`) });
      await shot('14-pricing-fr');
      try {
        // Valeur illisible : jamais envoyée à l'API
        await form.locator('input[name="baseFare"]').fill('abc');
        await form.getByRole('button', { name: 'Enregistrer' }).click();
        await ui(page.getByText('Données invalides, vérifiez le formulaire.')).toBeVisible();
        expect((await call('GET', '/admin/pricing/rules', adminToken)).body.find((r: any) => r.id === standard.id).baseFare).toBe(standard.baseFare);

        // Virgule décimale française : « 2,5 » = 2 500 millimes
        await page.goto('/pricing');
        const again = page.locator('form', { has: page.locator(`input[name="id"][value="${standard.id}"]`) });
        await again.locator('input[name="baseFare"]').fill('2,5');
        await again.getByRole('button', { name: 'Enregistrer' }).click();
        await ui(page.getByRole('status')).toContainText('Tarification mise à jour');
        expect((await call('GET', '/admin/pricing/rules', adminToken)).body.find((r: any) => r.id === standard.id).baseFare).toBe(2_500);
      } finally {
        await page.goto('/pricing');
        const restore = page.locator('form', { has: page.locator(`input[name="id"][value="${standard.id}"]`) });
        await restore.locator('input[name="baseFare"]').fill(original);
        await restore.getByRole('button', { name: 'Enregistrer' }).click();
        await ui(page.getByRole('status')).toContainText('Tarification mise à jour');
      }
      expect((await call('GET', '/admin/pricing/rules', adminToken)).body.find((r: any) => r.id === standard.id).baseFare).toBe(standard.baseFare);
    });

    it('journal : décisions et modification de tarification avec valeur avant → après', async () => {
      await page.goto('/audit');
      await page.getByRole('heading', { name: 'Journal des actions', level: 1 }).waitFor();
      await ui(page.getByText('Tarification modifiée').first()).toBeVisible();
      await ui(page.getByText(/Prise en charge : 1,500 DT → 2,500 DT/).first()).toBeVisible();
      await ui(page.getByText('Chauffeur validé').first()).toBeVisible();
      await ui(page.getByText('Document refusé').first()).toBeVisible();
      await shot('15-audit-fr');
    });
  });

  it("passe en arabe : sens de lecture inversé, textes traduits, choix conservé", async () => {
    await page.goto('/tickets');
    await page.getByRole('button', { name: 'العربية' }).click();
    await ui(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await ui(page.locator('html')).toHaveAttribute('lang', 'ar');
    await page.getByRole('heading', { name: 'البلاغات', level: 1 }).waitFor();
    await shot('08-tickets-ar');

    await page.getByRole('link', { name: 'السائقون' }).click();
    await page.getByRole('heading', { name: 'مراجعة السائقين' }).waitFor();
    await shot('09-drivers-ar');

    await page.getByRole('link', { name: 'لوحة القيادة' }).click();
    await page.getByRole('heading', { name: 'لوحة القيادة', level: 1 }).waitFor();
    await shot('16-dashboard-ar');

    // Le choix de langue survit à une nouvelle visite et s'applique aussi à la connexion
    const fresh = await browser.newContext({ baseURL: ADMIN, storageState: await context.storageState() });
    const other = await fresh.newPage();
    await other.goto('/drivers');
    await ui(other.locator('html')).toHaveAttribute('dir', 'rtl');
    await fresh.close();
  });

  it('renouvelle la session quand le cookie d\'accès a expiré', async () => {
    const before = (await context.cookies()).find((c) => c.name === 'vtc_at')!.value;
    await context.clearCookies({ name: 'vtc_at' });
    expect((await context.cookies()).map((c) => c.name)).not.toContain('vtc_at');

    await page.goto('/tickets');
    expect(here()).toBe('/tickets');
    const after = (await context.cookies()).find((c) => c.name === 'vtc_at');
    expect(after?.value).toBeTruthy();
    expect(after?.value).not.toBe(before);
  });

  it('se déconnecte : cookies effacés et pages protégées de nouveau fermées', async () => {
    await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await page.waitForURL('**/login');
    await shot('10-login-ar');
    expect((await context.cookies()).map((c) => c.name)).not.toContain('vtc_rt');

    await page.goto('/tickets');
    expect(here()).toBe('/login');
  });
});
