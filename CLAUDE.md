# VTC Tunisie

Plateforme VTC (type Uber/Bolt) pour le marché tunisien. Monorepo pnpm : `apps/api` (NestJS 12, ESM) est la seule app pour l'instant ; apps mobiles (Expo) et back-office (Next.js) arrivent en Phase 2. Architecture complète, modèle de données et points à valider juridiquement : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commandes (depuis la racine)

```bash
pnpm infra:up                    # Postgres+PostGIS :5433, Redis :6380 (docker compose)
pnpm api build                   # tsc → dist/ (db:migrate et db:seed tournent depuis dist/)
pnpm api db:migrate && pnpm api db:seed
pnpm api dev                     # build + démarre sur :3000 — Swagger sur /docs
pnpm api typecheck               # inclut test/
pnpm api test                    # unitaires (src/**/*.spec.ts), sans infra
pnpm api test:e2e                # parcours complet : exige l'API démarrée + Postgres + Redis
```

Après un changement de `src/db/schema.ts` : `pnpm api db:generate` (génère la migration **et** retire les guillemets des types PostGIS), relire le SQL, puis `pnpm api build && pnpm api db:migrate`. Ne jamais éditer une migration déjà appliquée.

Tests e2e : par défaut contre `http://localhost:3000`. Pour ne pas toucher à un serveur déjà lancé : `PORT=3005 node dist/main.js` puis `API_URL=http://localhost:3005 pnpm api test:e2e`. Ils supposent la configuration par défaut (code OTP `123456`, pièces chauffeur obligatoires) et créent des comptes aléatoires dans la base de dev.

## Architecture de `apps/api/src`

Monolithe modulaire, un dossier par domaine dans `modules/` (`auth`, `users`, `drivers`, `matching`, `trips`, `pricing`, `routing`, `places`, `notifications`, `support`, `admin`, `realtime`). `infra/` regroupe Postgres (Drizzle), Redis, la file BullMQ, le stockage de fichiers et l'émetteur Socket.IO. Les dépendances prévues entre modules sont décrites dans `docs/ARCHITECTURE.md`.

- **Deux rôles de processus** (`PROCESS_ROLE`) : `api` (HTTP + WebSocket), `worker` (files BullMQ : matching, purge GPS), `all` en dev.
- **Fournisseurs interchangeables** derrière une interface + un `Symbol` d'injection : SMS (`SmsProvider`), push (`PushProvider`), routage (`RoutingProvider`), adresses (`GeocodingProvider`), stockage (`ObjectStorage`). Les implémentations « console » / « static » / disque local sont réservées au dev ; brancher le vrai service en remplaçant uniquement l'implémentation.
- **Temps réel** : Socket.IO, namespace `/rt`, jeton d'accès au handshake. Toute émission passe par `RealtimeEmitter` (via Redis), jamais par le serveur directement. Le WebSocket n'est qu'une accélération : l'état de référence se relit par HTTP (`GET /trips/active`).
- **Matching** : offres séquentielles à un chauffeur à la fois (position en Redis GEO), délais gérés par BullMQ, écritures conditionnelles (`WHERE status = …`) pour rester correct avec plusieurs workers.

## Conventions

- **Validation** : schémas Zod passés par `new ZodPipe(schema)` sur `@Body()` / `@Query()`. Les corps Zod sont convertis automatiquement en schéma Swagger (`src/swagger.ts`) ; une route multipart décrit son corps à la main avec `@ApiBody`.
- **Erreurs** : toujours `AppError(code, message, status)` ou `Errors.*`. Le `code` (ex. `DRIVER_NOT_APPROVED`) est stable et traduit par les apps ; le `message` est pour les développeurs.
- **Argent** : entiers en **millimes** (1 DT = 1000 millimes), jamais de flottants. Prix garanti par le devis (`quoteId`), final = devis.
- **Données sensibles** : CIN et n° de permis chiffrés (`FieldCipher`) + empreinte pour l'unicité ; ne jamais les journaliser ni les renvoyer en clair (l'admin les voit masqués). Les fichiers de documents ne sortent que par une route admin authentifiée.
- **Idempotence** : `Idempotency-Key` sur `POST /trips`, positions GPS dédupliquées par `(trip_id, recorded_at)`, `cash-collected` rejouable.
- **Notifications** : passer par `NotificationsService.notify(...)` (ne lève jamais, ne pas l'`await` dans un flux métier). Les textes fr/ar sont dans `modules/notifications/messages.ts`.
- **Pagination** : curseur sur la date (`nextCursor` = `createdAt`/`requestedAt` ISO du dernier élément), comparée à la milliseconde car Postgres stocke des microsecondes.
- **Langue** : code, commentaires, messages et docs en français (le mélange français/anglais est évité).
- **Fins de ligne** : le dépôt mélange LF et CRLF selon les fichiers (Windows). Conserver celles du fichier édité ; ne pas reformater un fichier entier.

## Configuration

`apps/api/.env` (non versionné) ; modèle dans `.env.example`. `env()` dans `src/config/env.ts` valide tout au démarrage et refuse les combinaisons dangereuses en production (code OTP fixe, jeu d'adresses intégré). Pour tester à la main sans envoyer les pièces chauffeur : `DRIVER_REQUIRED_DOCUMENTS=` (vide).

## Phase en cours

Phase 1 (backend, testable par Postman/Swagger, aucune interface) terminée côté code ; reste à la valider à la main de bout en bout. **Ne pas démarrer d'interface avant cette validation.** Reste à brancher hors-code : agrégateur SMS, FCM/Expo, serveur OSRM, bucket S3 privé.
