/**
 * Crée un chauffeur au dossier complet et validé (pièces envoyées, approuvées, compte approuvé par l'admin) pour essayer
 * l'app chauffeur à la main. Affiche le numéro à saisir ; le code SMS est 123456 en développement.
 *
 *   node seed-driver.mjs            crée un nouveau chauffeur (API_URL=http://localhost:3010/v1 par défaut)
 *   node seed-driver.mjs 22123456   complète et valide le dossier d'un compte déjà inscrit dans l'app chauffeur
 *
 * Nécessite l'admin créé par `db:seed` (+21620000000).
 */
import { Redis } from 'ioredis';
import { crc32, deflateSync } from 'node:zlib';

const API = process.env.API_URL ?? 'http://localhost:3010/v1';
const OTP = '123456';
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

function png() {
  const [width, height] = [120, 80];
  const chunk = (type, data) => {
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
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(phone) {
  await call('POST', '/auth/otp/request', undefined, { phone });
  const { body } = await call('POST', '/auth/otp/verify', undefined, { phone, code: OTP });
  return { token: body.accessToken, userId: body.user.id };
}

// Les limites d'envoi d'OTP (60 s par numéro) empêcheraient de se connecter ensuite dans l'interface
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380');
const clear = async () => {
  const keys = [...(await redis.keys('otp:cooldown:*')), ...(await redis.keys('otp:rl:*'))];
  if (keys.length) await redis.del(...keys);
};

const local = process.argv[2] ?? `22${digits(6)}`;
if (!/^[2459]\d{7}$/.test(local)) throw new Error('Numéro attendu : 8 chiffres, par exemple 22123456');
await clear();
const driver = await login(`+216${local}`);
await call('PATCH', '/me', driver.token, { fullName: 'Sami Essai' });
await call('POST', '/drivers/onboarding', driver.token, { cinNumber: digits(8), licenseNumber: `P${digits(8)}`, licenseExpiry: '2030-01-01' });
await call('POST', '/drivers/me/vehicles', driver.token, { make: 'Kia', model: 'Picanto', color: 'Blanc', year: 2021, plate: `${digits(3)} تونس ${digits(4)}` });
for (const type of ['cin', 'driving_license', 'vehicle_registration', 'insurance']) {
  const form = new FormData();
  form.set('type', type);
  if (type === 'insurance') form.set('expiresAt', '2030-01-01');
  form.set('file', new Blob([png()]), 'scan.png');
  const res = await fetch(`${API}/drivers/me/documents`, { method: 'POST', headers: { authorization: `Bearer ${driver.token}` }, body: form });
  if (res.status !== 201) throw new Error(`Envoi du document ${type} refusé (${res.status})`);
}
await clear();
const admin = await login('+21620000000');
const docs = (await call('GET', `/admin/drivers/${driver.userId}`, admin.token)).body.documents;
for (const doc of docs) await call('POST', `/admin/drivers/${driver.userId}/documents/${doc.id}/approve`, admin.token);
const approved = await call('POST', `/admin/drivers/${driver.userId}/approve`, admin.token);
if (approved.status !== 200) throw new Error(`Validation du chauffeur refusée (${approved.status})`);
await clear();
await redis.quit();

console.log(`Chauffeur prêt : numéro ${local} (code ${OTP})`);
