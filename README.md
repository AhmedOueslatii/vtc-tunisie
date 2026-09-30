# VTC Tunisie

Plateforme de VTC pour le marché tunisien : API (NestJS), app mobile passager/chauffeur (Expo, à venir), back-office (Next.js, à venir).

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

## Tests

```bash
pnpm test        # unitaires
pnpm test:e2e    # parcours complet — nécessite l'API démarrée
```

## Structure

```
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
    └── admin/         validation des chauffeurs
```

Après une modification de `db/schema.ts` : `pnpm db:generate` puis `pnpm build && pnpm db:migrate`.
