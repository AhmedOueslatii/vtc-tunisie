# VTC Tunisie

Plateforme de VTC pour le marché tunisien : API (NestJS), back-office admin (Next.js), apps mobiles passager/chauffeur (Expo, à venir).

Architecture, modèle de données, API et points à valider juridiquement : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Démarrer

Prérequis : Node 22+, pnpm 10, Docker.

```bash
pnpm install
pnpm infra:up                         # PostGIS :5433, Redis :6380
cd apps/api
cp .env.example .env
pnpm build && pnpm db:migrate && pnpm db:seed
pnpm start                            # http://localhost:3000/v1  (OTP de dev : 123456, affiché aussi dans les logs)
```

Back-office (dans un autre terminal, l'API étant démarrée) :

```bash
pnpm admin dev                        # http://localhost:3001 — connexion avec le numéro admin du seed (+21620000000, code 123456)
```

## Tests

```bash
pnpm api test               # unitaires de l'API
pnpm api test:e2e           # parcours API complet — nécessite l'API démarrée
pnpm admin test             # unitaires du back-office
pnpm admin test:e2e         # parcours dans un navigateur (Chromium) — nécessite API + back-office démarrés
```

Premier lancement des tests navigateur : `pnpm --filter @vtc/admin exec playwright install chromium`.

## Structure

```
apps/admin/src          back-office Next.js (App Router) : tableau de bord, chauffeurs, courses, tarification, signalements, journal ; fr/ar (RTL)
apps/api/src
├── common/            téléphone +216, plaques, géo, chiffrement, erreurs
├── config/env.ts      configuration validée (zod)
├── db/                schéma Drizzle, migrations, seed
├── infra/             Postgres, Redis, file BullMQ, émetteur Socket.IO
└── modules/
    ├── auth/          OTP SMS, JWT, refresh tokens rotatifs
    ├── users/         /me
    ├── drivers/       onboarding, véhicules, disponibilité, positions (Redis GEO)
    ├── matching/      offres séquentielles + worker BullMQ
    ├── trips/         devis, demande, cycle de vie, annulation
    ├── pricing/ routing/
    ├── realtime/      Socket.IO (namespace /rt)
    ├── admin/         chauffeurs, documents, courses, tarification, statistiques
    └── audit/         journal des actions admin
```

Après une modification de `db/schema.ts` : `pnpm db:generate` puis `pnpm build && pnpm db:migrate`.
