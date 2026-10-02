import { z } from 'zod';
import { DOCUMENT_TYPES } from '../db/schema.js';

const csvInts = (def: string) =>
  z
    .string()
    .default(def)
    .transform((s) => s.split(',').map((v) => Number.parseInt(v.trim(), 10)))
    .pipe(z.array(z.number().int().positive()).min(1));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    PROCESS_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    CORS_ORIGINS: z.string().default(''),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_S: z.coerce.number().int().default(15 * 60),
    REFRESH_TTL_DAYS: z.coerce.number().int().default(30),
    OTP_SECRET: z.string().min(32),
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((k) => Buffer.from(k, 'base64').length === 32, 'doit faire 32 octets en base64'),

    SMS_PROVIDER: z.enum(['console']).default('console'),
    OTP_DEV_FIXED_CODE: z.string().regex(/^\d{6}$/).optional(),

    // Documents chauffeur : stockage privé local en dev (remplacer par un bucket S3 privé en production)
    STORAGE_DIR: z.string().default('./storage'),
    MAX_DOCUMENT_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
    // Durée de validité d'un lien signé vers un scan (secondes) : assez pour lire la fiche, pas pour partager le lien
    DOCUMENT_LINK_TTL_S: z.coerce.number().int().min(30).max(3600).default(300),
    // Pièces à faire valider avant d'approuver un chauffeur (CSV ; vide = aucune, pour les tests manuels)
    // [À VALIDER] liste exacte exigée par la réglementation (bulletin n°3, etc.)
    DRIVER_REQUIRED_DOCUMENTS: z
      .string()
      .default('cin,driving_license,vehicle_registration,insurance')
      .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
      .pipe(z.array(z.enum(DOCUMENT_TYPES))),

    // Trace GPS des courses : durée de conservation (protection des données, INPDP)
    LOCATION_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

    // Matching
    MATCHING_RADII_M: csvInts('3000,5000,8000'),
    MATCHING_OFFER_TIMEOUT_S: z.coerce.number().int().default(15),
    MATCHING_MAX_SEARCH_S: z.coerce.number().int().default(90),
    MATCHING_RETRY_DELAY_S: z.coerce.number().int().default(5),
    DRIVER_STALE_AFTER_S: z.coerce.number().int().default(30),

    // Cartographie : fournisseurs interchangeables (voir docs/ARCHITECTURE.md)
    GEOCODING_PROVIDER: z.enum(['static', 'nominatim']).default('static'),
    NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
    NOMINATIM_USER_AGENT: z.string().default('vtc-tunisie-api'),
    ROUTING_PROVIDER: z.enum(['straight', 'osrm']).default('straight'),
    OSRM_URL: z.string().url().default('http://localhost:5000'),

    // Courses
    QUOTE_TTL_S: z.coerce.number().int().default(300),
    CANCEL_FREE_WINDOW_S: z.coerce.number().int().default(120),
  })
  .refine((e) => !(e.NODE_ENV === 'production' && e.OTP_DEV_FIXED_CODE), {
    message: 'OTP_DEV_FIXED_CODE est interdit en production',
    path: ['OTP_DEV_FIXED_CODE'],
  })
  .refine((e) => !(e.NODE_ENV === 'production' && e.GEOCODING_PROVIDER === 'static'), {
    message: "le jeu d'adresses intégré est réservé au développement : choisir nominatim (ou un autre fournisseur)",
    path: ['GEOCODING_PROVIDER'],
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  try {
    process.loadEnvFile();
  } catch {
    // pas de fichier .env : on s'appuie sur l'environnement du processus
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Configuration invalide :\n${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}
