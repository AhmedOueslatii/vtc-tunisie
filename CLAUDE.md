# VTC Tunisie

Plateforme VTC (type Uber/Bolt) pour le marché tunisien. Monorepo pnpm : `apps/api` (NestJS 12, ESM) et `apps/admin` (back-office Next.js 16, App Router) ; apps mobiles (Expo) à venir. Architecture complète, modèle de données et points à valider juridiquement : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

Tests e2e : par défaut contre `http://localhost:3000`. Pour ne pas toucher à un serveur déjà lancé : `PORT=3005 node dist/main.js` puis `API_URL=http://localhost:3005 pnpm api test:e2e`. Ils supposent la configuration par défaut (code OTP `123456`, pièces chauffeur obligatoires) et créent des comptes aléatoires dans la base de dev. **Ne pas relancer une suite e2e juste après une autre** : le chauffeur de l'exécution précédente reste « en ligne » 30 s, et les courses qu'elle a laissées en recherche (jusqu'à 90 s) reçoivent l'offre avant le chauffeur du test, qui expire alors à 5 s. Attendre environ 2 minutes (après un échec surtout) avant de relancer.

## Back-office (`apps/admin`)

```bash
pnpm admin dev                   # :3001 — API_URL (défaut http://localhost:3000/v1), voir apps/admin/.env.example
pnpm admin typecheck && pnpm admin test     # unitaires (traductions, cookies de session, renouvellement)
pnpm admin test:e2e              # navigateur Chromium : exige l'API + le back-office démarrés (ADMIN_URL, API_URL)
```

- **Next.js 16 ≠ ce que vous connaissez** : `middleware` s'appelle `proxy` (`src/proxy.ts`), `cookies()`/`params`/`searchParams` sont asynchrones. La doc de la version installée est dans `apps/admin/node_modules/next/dist/docs/` — la lire avant d'utiliser une API Next.
- **Le navigateur ne parle jamais à l'API** : les pages serveur et les actions serveur appellent l'API avec le jeton lu dans un cookie **httpOnly** (`lib/api.ts`). `proxy.ts` renouvelle la session avant le rendu (le cookie d'accès expire 30 s avant le jeton). Chaque action est de toute façon contrôlée par l'API (rôle admin) : ne pas compter sur le proxy seul.
- **Formulaires = actions serveur** (`actions.ts` à côté de la page) qui redirigent avec `?notice=…` ou `?error=CODE` ; seuls des codes connus sont traduits et affichés, jamais le texte de l'API ni un texte libre de l'URL. `returnTo` n'accepte que des chemins internes.
- **Bilingue fr/ar dès le départ** : textes dans `lib/messages.ts` (clés plates, `ar` doit avoir les mêmes clés et variables — contrôlé par test), `<html dir>` selon la langue, classes Tailwind logiques (`ms-`, `text-start`, `border-s`…) plutôt que `left/right`. Numéros de téléphone en `dir="ltr"`.
- **Scans de documents** : le navigateur les charge directement depuis l'API par **liens signés** (HMAC, 5 min, liés au document et à l'admin : `apps/api/src/modules/drivers/document-links.ts`). La page demande les liens via `POST /admin/drivers/:id/documents/links` (journalisé) ; « Ouvrir dans un nouvel onglet » passe par `…/documents/:docId/open` qui en émet un neuf. `API_PUBLIC_URL` = adresse de l'API vue du navigateur. Les numéros CIN/permis arrivent déjà masqués. Un lien est une capacité : toute personne qui l'a peut lire ce scan jusqu'à son expiration.
- `apiRaw` rejoue une fois les GET après un échec de connexion, jamais les écritures ; il annule le corps des réponses qu'il n'utilise pas.
- **Nombres** : espace pour les milliers et virgule décimale dans les DEUX langues (`lib/format.ts`). Le format arabe par défaut (« 3.000 ») se lit comme 3 dinars.
- **Problème connu, non résolu** : en exécutant `pnpm admin test:e2e` en boucle (Windows, Node 22), le processus Next.js se fige de temps en temps 7 à 10 s (≈ 1 exécution sur 4), ce qui fait expirer des appels (10 s) et échouer un test. Mesuré : boucle d'événements de Next gelée, profil CPU dans une écriture de socket TCP du client HTTP (undici) ; l'API n'est pas gelée ; un script Node seul n'y arrive pas. Écarté : flux non lus, keep-alive, relais des scans, IPv6 vs IPv4. Jamais observé en usage manuel (non vérifié). Pour un échec isolé, relancer ; ne pas conclure à un bug applicatif sans mesurer (`NODE_OPTIONS=--import` d'un préchargeur qui journalise le retard de la boucle d'événements).
- **Écrans** : tableau de bord (`/`, tuiles + 2 graphiques en colonnes), chauffeurs, courses (liste + fiche avec carte Leaflet/OSM et trace GPS), tarification (saisie en dinars ↔ millimes dans `lib/money.ts`), portefeuilles (dettes de commission, règlements), utilisateurs (recherche, suspension), exports CSV, signalements, journal d'audit (filtrable par type d'élément : les consultations de documents le remplissent vite). Les écrans de modification passent par des actions serveur qui renvoient `?notice=`/`?error=`. Les téléchargements CSV passent par une route du back-office (`/exports/[kind]`, jeton admin) qui lit le fichier en entier avant de répondre.
- **Graphiques** : composant `components/bar-chart.tsx` (SVG, une série, infobulle au survol et au clavier, tableau de données en alternative). Couleur = emplacement 1 de la palette de visualisation (validée clair/sombre) via `--series-1` ; géométrie dans `lib/chart.ts` (testée). Jamais deux axes sur un graphique : deux mesures = deux graphiques.
- **Tests navigateur** : toujours attendre explicitement (`poll` = 15 s) ; `expect.poll` n'attend que 1 s par défaut. Les chauffeurs d'une exécution précédente restent « en ligne » 30 s et peuvent recevoir l'offre avant le chauffeur du test (15 s par offre) : ne pas enchaîner deux exécutions sans laisser ce délai, ou accepter l'attente.
- Pas de bibliothèque de composants : classes Tailwind partagées dans `components/ui.tsx`, couleurs sémantiques (`bg-card`, `text-muted`…) définies dans `globals.css`, thème sombre automatique.

## Architecture de `apps/api/src`

Monolithe modulaire, un dossier par domaine dans `modules/` (`auth`, `users`, `drivers`, `matching`, `trips`, `pricing`, `routing`, `places`, `notifications`, `support`, `wallet`, `audit`, `admin`, `realtime`). `infra/` regroupe Postgres (Drizzle), Redis, la file BullMQ, le stockage de fichiers et l'émetteur Socket.IO. Les dépendances prévues entre modules sont décrites dans `docs/ARCHITECTURE.md`.

- **Deux rôles de processus** (`PROCESS_ROLE`) : `api` (HTTP + WebSocket), `worker` (files BullMQ : matching, purge GPS), `all` en dev.
- **Fournisseurs interchangeables** derrière une interface + un `Symbol` d'injection : SMS (`SmsProvider`), push (`PushProvider`), routage (`RoutingProvider`), adresses (`GeocodingProvider`), stockage (`ObjectStorage`). Les implémentations « console » / « static » / disque local sont réservées au dev ; brancher le vrai service en remplaçant uniquement l'implémentation.
- **Temps réel** : Socket.IO, namespace `/rt`, jeton d'accès au handshake. Toute émission passe par `RealtimeEmitter` (via Redis), jamais par le serveur directement. Le WebSocket n'est qu'une accélération : l'état de référence se relit par HTTP (`GET /trips/active`).
- **Matching** : offres séquentielles à un chauffeur à la fois (position en Redis GEO), délais gérés par BullMQ, écritures conditionnelles (`WHERE status = …`) pour rester correct avec plusieurs workers.

## Conventions

- **Validation** : schémas Zod passés par `new ZodPipe(schema)` sur `@Body()` / `@Query()`. Les corps Zod sont convertis automatiquement en schéma Swagger (`src/swagger.ts`) ; une route multipart décrit son corps à la main avec `@ApiBody`.
- **Erreurs** : toujours `AppError(code, message, status)` ou `Errors.*`. Le `code` (ex. `DRIVER_NOT_APPROVED`) est stable et traduit par les apps ; le `message` est pour les développeurs.
- **Argent** : entiers en **millimes** (1 DT = 1000 millimes), jamais de flottants. Prix garanti par le devis (`quoteId`), final = devis.
- **Données sensibles** : CIN et n° de permis chiffrés (`FieldCipher`) + empreinte pour l'unicité ; ne jamais les journaliser ni les renvoyer en clair (l'admin les voit masqués). Les fichiers de documents ne sortent que par une route admin authentifiée.
- **Portefeuille chauffeur** (`modules/wallet`) : solde négatif = dette de commissions cash envers la plateforme. La commission (taux **figé au devis** dans `trips.commission_bps`, pas celui du jour) est créée dans la même transaction que l'encaissement `cash-collected`, une seule fois par course (index unique). Le grand livre (`wallet_transactions`) n'est jamais modifié ni supprimé ; chaque ligne porte le solde qui en résulte. Au plafond `DRIVER_DEBT_CEILING` le chauffeur est mis hors ligne et ne peut plus repasser en ligne (`DEBT_LIMIT_REACHED`) ; avertissement à 80 %. L'admin enregistre des règlements (jamais au-delà de la dette) et des ajustements signés et motivés, journalisés dans la même transaction. Les règles pures sont dans `wallet/commission.ts`.
- **Suspension d'un compte** (`admin/admin-users.controller.ts`) : refusée pendant une course (passager ou chauffeur), pour un admin et pour soi-même. Effet immédiat malgré le jeton d'accès de 15 min : marqueur Redis `suspended:{id}` vérifié par `TokensService.verifyAccess` (durée = jeton + 60 s), sessions révoquées avec le motif `suspended`, connexions Socket.IO fermées (`RealtimeEmitter.disconnectUser`), chauffeur mis hors ligne, SMS. Le statut en base arrête la connexion et le renouvellement au-delà du marqueur. La réactivation ne remet pas le chauffeur en ligne.
- **Exports CSV** (`common/csv.ts`, `admin-exports.controller.ts`) : séparateur `;`, virgule décimale, BOM UTF-8 (Excel), CRLF ; **toute cellule texte commençant par `= + - @` est neutralisée** (injection de formule : les adresses sont saisies par les utilisateurs) ; les montants passent par `money()`, jamais comme texte. Pas de téléphone des passagers ; chaque export est journalisé avant d'être livré (périodes en jours calendaires à Tunis, 366 jours, 50 000 lignes).
- **Idempotence** : `Idempotency-Key` sur `POST /trips`, positions GPS dédupliquées par `(trip_id, recorded_at)`, `cash-collected` rejouable.
- **Notifications** : passer par `NotificationsService.notify(...)` (ne lève jamais, ne pas l'`await` dans un flux métier). Les textes fr/ar sont dans `modules/notifications/messages.ts`.
- **Pagination** : curseur sur la date (`nextCursor` = `createdAt`/`requestedAt` ISO du dernier élément), comparée à la milliseconde car Postgres stocke des microsecondes.
- **Langue** : code, commentaires, messages et docs en français (le mélange français/anglais est évité).
- **Fins de ligne** : le dépôt mélange LF et CRLF selon les fichiers (Windows). Conserver celles du fichier édité ; ne pas reformater un fichier entier.

## Configuration

`apps/api/.env` (non versionné) ; modèle dans `.env.example`. `env()` dans `src/config/env.ts` valide tout au démarrage et refuse les combinaisons dangereuses en production (code OTP fixe, jeu d'adresses intégré). Pour tester à la main sans envoyer les pièces chauffeur : `DRIVER_REQUIRED_DOCUMENTS=` (vide).

## Phase en cours

Phase 1 (backend) terminée côté code ; la validation manuelle de bout en bout reste à faire par le propriétaire du projet, qui a choisi de démarrer la Phase 2 en parallèle. Phase 2 : back-office admin complet pour l'étape actuelle (tableau de bord, chauffeurs, utilisateurs avec suspension, courses, portefeuilles, tarification, signalements, exports CSV, journal d'audit). Apps mobiles passager/chauffeur : pas commencées ; décision prise avec le propriétaire : **les deux apps passent d'abord par des preuves de concept web** (à voir et essayer dans le navigateur) avant les apps natives.

Reste à brancher hors-code : agrégateur SMS, FCM/Expo, serveur OSRM, bucket S3 privé.
