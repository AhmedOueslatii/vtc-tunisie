# Architecture — Plateforme VTC Tunisie

> Statut : proposition v1 (MVP). Les points marqués **[À VALIDER]** dépendent d'une
> vérification juridique, commerciale ou tarifaire qu'on ne peut pas trancher techniquement.

## 1. Choix structurants

| Sujet | Choix | Pourquoi |
|---|---|---|
| Langage | **TypeScript partout** | Un seul langage pour l'API, l'app mobile et l'admin : types partagés (statuts de course, événements temps réel, calcul de prix) via `packages/shared`. |
| Backend | **NestJS, monolithe modulaire** | Une équipe réduite ne gagne rien à opérer 8 microservices au MVP. Les modules ont des frontières strictes (pas d'accès direct aux tables d'un autre module), donc `matching` ou `notifications` pourront être extraits plus tard sans réécriture. |
| Modes d'exécution | même image, 2 rôles : `api` (HTTP + WebSocket) et `worker` (files BullMQ) | Scalabilité horizontale indépendante : on ajoute des `api` pour les connexions, des `worker` pour le matching/les notifications. |
| Base | **PostgreSQL 16 + PostGIS** | Zones tarifaires (polygones), historique GPS, requêtes d'analyse géo. |
| ORM | **Drizzle** | SQL-first, types PostGIS natifs, migrations générées sans base, ESM natif. |
| Temps réel | **Redis** (GEO + état chauffeur) + **Socket.IO** avec adaptateur Redis | Les positions (toutes les 3–5 s) ne touchent **jamais** Postgres dans le chemin chaud : `GEOSEARCH` Redis répond en < 1 ms. |
| Files | **BullMQ** (sur Redis) | Timeouts d'offres, notifications, facturation. Pas de RabbitMQ au MVP : une brique d'infra de moins. |
| Mobile | **React Native (Expo)**, une base de code, deux apps (passager / chauffeur) | Partage des types avec le backend ; RTL natif via `I18nManager`. |
| Admin | **Next.js + shadcn/ui** | |
| Argent | **entiers en millimes** (1 TND = 1000 millimes) | Le dinar a 3 décimales ; aucun flottant dans les montants. |

## 2. Vue d'ensemble

```
 App Passager ─┐                         ┌──────────── worker (N) ─────────────┐
 App Chauffeur ┼─ HTTPS / WSS ─► LB ─► api (N) ─┐  matching · notifications · billing │
 Admin (Next) ─┘                     │          └────────────────────────────────────┘
                                     │                    │
                          ┌──────────┴─────┐      ┌───────┴───────┐
                          │ PostgreSQL     │      │ Redis         │
                          │ + PostGIS      │      │ GEO, état,    │
                          │ (vérité)       │      │ OTP, BullMQ,  │
                          └────────────────┘      │ pub/sub WS    │
                                                  └───────────────┘
 Externes (derrière des interfaces, donc remplaçables) :
   SmsProvider · RoutingProvider (OSRM/Google) · GeocodingProvider · PaymentProvider (Flouci/Konnect/ClicToPay) · PushProvider (FCM)
```

## 3. Modules backend (`apps/api/src/modules`)

| Module | Responsabilité | Phase |
|---|---|---|
| `auth` | OTP SMS +216, JWT d'accès (15 min) + refresh tokens rotatifs avec détection de réutilisation | 1 ✅ |
| `users` | Profil, langue (fr/ar), notes moyennes | 1 ✅ |
| `drivers` | Onboarding, documents, véhicules, disponibilité, positions | 1 ✅ (docs : upload en phase 1b) |
| `pricing` | Devis : base + km + minute, minimum, zones, multiplicateur (surge prévu dès le schéma) | 1 ✅ |
| `routing` | Distance/durée. MVP : haversine × facteur de détour ; ensuite OSRM auto-hébergé | 1 ✅ (approx.) |
| `trips` | Machine à états de la course, annulation et pénalités | 1 ✅ (matching) / 1b (cycle complet) |
| `matching` | Recherche du chauffeur le plus proche, offres séquentielles avec timeout | 1 ✅ |
| `realtime` | Passerelle Socket.IO, rooms `user:{id}` et `trip:{id}` | 1 ✅ |
| `payments` / `wallet` | Cash d'abord ; grand livre chauffeur ; Flouci/Konnect ensuite | 1b (cash) / 2 |
| `ratings`, `support` | Notation bidirectionnelle, signalements | 1b |
| `notifications` | Push FCM + SMS critiques | 2 |
| `admin` | API du back-office | 2 |

## 4. Modèle de données

Toutes les clés sont des UUID. Tous les montants en millimes (`integer`). Horodatages en `timestamptz`.

```
users ─1:1─ driver_profiles ─1:N─ driver_documents
  │                │
  │                └─1:N─ vehicles
  │
  ├─1:N─ sessions (refresh tokens hachés)
  ├─1:1─ wallets ─1:N─ wallet_transactions (grand livre, append-only)
  │
  └─1:N─ trips (passenger_id, driver_id, vehicle_id)
            ├─1:N─ trip_offers   (audit du matching : qui a reçu, refusé, laissé expirer)
            ├─1:N─ trip_events   (audit des transitions d'état)
            ├─1:N─ payments
            ├─1:N─ ratings       (unique (trip_id, rater_id))
            └─1:N─ location_points (uniquement pendant une course)

zones (polygone PostGIS) ─1:N─ pricing_rules (par catégorie de véhicule)
support_tickets → users, trips
notifications → users
```

Contraintes clés :
- `users.phone` unique, format E.164 (`+216XXXXXXXX`).
- `vehicles.plate` unique ; un seul véhicule `is_active` par chauffeur (index unique partiel).
- `trips` : transitions contrôlées par des `UPDATE … WHERE status = <attendu>` (verrou optimiste) — deux chauffeurs ne peuvent pas accepter la même course.
- Un passager n'a qu'une seule course active (index unique partiel sur `passenger_id` pour les statuts actifs).
- `wallet_transactions` : append-only, `balance_after` stocké pour l'audit ; le solde du wallet n'est modifié que dans la même transaction SQL.
- Données sensibles (n° CIN, n° de permis) chiffrées au niveau applicatif (AES-256-GCM, clé hors base) + empreinte HMAC pour les recherches d'unicité.

Le schéma exact est dans [`apps/api/src/db/schema.ts`](../apps/api/src/db/schema.ts).

## 5. Machine à états d'une course

```
requested ──(chauffeur accepte)──► driver_assigned ──► driver_arrived ──► in_progress ──► completed
    │                                   │                    │
    ├─► no_driver_found (rayon max épuisé)
    └─► cancelled_by_passenger ◄────────┴────────────────────┘   (gratuit < 2 min après l'assignation,
                                        └─► cancelled_by_driver     pénalité ensuite / après arrivée + 5 min)
```

## 6. Matching (phase 1)

1. Le chauffeur passe en ligne → `driver:state:{id}` (hash Redis) + position dans `geo:drivers:{catégorie}`.
2. Positions : Socket.IO `driver:location` toutes les 4 s (fallback HTTP `POST /drivers/me/location`, qui accepte un lot pour les réseaux instables).
3. Demande de course → `GEOSEARCH` rayon 3 km, puis 5 km, puis 8 km (configurable), tri par distance.
4. Filtre : en ligne, pas en course, dernière position < 30 s, n'a pas déjà refusé cette course, dette cash sous le plafond.
5. **Offre séquentielle** au meilleur candidat, verrou `SET NX` sur le chauffeur (15 s), timeout via job BullMQ retardé (fiable en multi-instances).
6. Acceptation = `UPDATE trips SET status='driver_assigned' WHERE id=? AND status='requested' AND offered_driver_id=?`.
7. Refus/expiration → candidat suivant. Plus de candidat au rayon max → `no_driver_found`.

Évolutions prévues : score = f(ETA routière réelle, note, taux d'acceptation), offres groupées aux heures de pointe, matching par lots.

## 7. API (v1)

```
Auth
  POST /v1/auth/otp/request        { phone }
  POST /v1/auth/otp/verify         { phone, code }            → { accessToken, refreshToken, user, isNewUser }
  POST /v1/auth/refresh            { refreshToken }
  POST /v1/auth/logout             { refreshToken }
Profil
  GET  /v1/me   PATCH /v1/me       { fullName, locale }
Chauffeur
  POST /v1/drivers/onboarding      { licenseNumber, licenseExpiry, cinNumber }
  POST /v1/drivers/me/vehicles     { make, model, color, plate, year, category }
  POST /v1/drivers/me/availability { online }
  POST /v1/drivers/me/location     { points: [{ lat, lng, heading?, speed?, ts }] }
  POST /v1/drivers/me/documents    multipart { type, expiresAt?, file }  (JPEG/PNG/PDF, 5 Mo ; assurance : expiresAt obligatoire)
  GET  /v1/drivers/me/documents    dernière version de chaque pièce + statut de revue
  GET  /v1/drivers/me/wallet?days&limit&cursor   solde, dette, plafond, gains (brut / commission / net) et mouvements
Adresses
  GET  /v1/places/search?q&lat&lng&limit   autocomplétion (fr/ar, Tunisie), triée par proximité si lat/lng → [{ id, name, address, lat, lng }]
  GET  /v1/places/reverse?lat&lng           adresse d'un point de la carte → { place | null }
Notifications
  GET  /v1/notifications?limit&cursor        boîte de réception → { items, unread, nextCursor }
  POST /v1/notifications/:id/read | /v1/notifications/read-all
  PUT  /v1/notifications/devices  { token, platform: android|ios }   à chaque démarrage de l'app
  DELETE /v1/notifications/devices?token=                            à la déconnexion
Support
  POST /v1/support/tickets         { category: incident|lost_item|payment|safety|other, description, tripId? }
  GET  /v1/support/tickets         mes signalements
Courses
  POST /v1/trips/estimate          { pickup, dropoff, category }  → { quoteId, priceMillimes, distanceM, durationS, expiresAt }
  POST /v1/trips                   { quoteId, paymentMethod: "cash" }
  GET  /v1/trips?limit&cursor      historique paginé (passager ou chauffeur) → { items, nextCursor }
  GET  /v1/trips/:id               ... driverEta { distanceM, durationS } tant que le chauffeur rejoint le passager
  GET  /v1/trips/:id/track         trace GPS de la course (participants) → { points, travelledDistanceM }
  POST /v1/trips/:id/cancel
  POST /v1/trips/:id/rating        { score: 1..5, comment? }  (course terminée, une note par participant)
  POST /v1/trips/:id/accept        (chauffeur)
  POST /v1/trips/:id/decline       (chauffeur)
  POST /v1/trips/:id/arrived|start|complete   (chauffeur)
  POST /v1/trips/:id/cash-collected           (chauffeur : paiement cash `pending` → `succeeded`)
Admin
  GET  /v1/admin/drivers/pending | /v1/admin/drivers/:id   file de validation, dossier (CIN/permis masqués) + pièces
  GET  /v1/admin/drivers/:id/documents/:docId/file          scan (avec jeton admin)
  POST /v1/admin/drivers/:id/documents/links { documentIds? } → { links, expiresAt }   liens signés vers les scans (5 min), journalisés
  GET  /v1/documents/:docId/file?e&a&s                       scan par lien signé (route publique : la signature fait foi, `no-store`)
  POST /v1/admin/drivers/:id/documents/:docId/approve|reject
  POST /v1/admin/drivers/:id/approve|reject                 approve exige les pièces DRIVER_REQUIRED_DOCUMENTS approuvées
  GET  /v1/admin/trips/:id/track                            trace GPS d'une course (litiges)
  GET  /v1/admin/tickets?status&limit&cursor | PATCH /v1/admin/tickets/:id  { status }
  GET  /v1/admin/trips?status=active|<statut>&limit&cursor  supervision des courses (passager, chauffeur, prix, statut)
  GET  /v1/admin/trips/:id                                   dossier complet : véhicule, paiement, historique des statuts, offres, notes, signalements
  GET  /v1/admin/pricing/rules | PATCH /v1/admin/pricing/rules/:id   tarification (millimes) ; modification journalisée, la règle par défaut ne peut pas être désactivée
  GET  /v1/admin/stats/overview?days=7|30|90                 activité en direct + indicateurs et courbe quotidienne (jours calendaires à Tunis)
  GET  /v1/admin/audit?entity&limit&cursor                   journal des actions admin (qui, quoi, avant/après)
  GET  /v1/admin/users?q&role&status&limit&cursor            recherche (nom ou téléphone), profil passager/chauffeur/admin, statut
  GET  /v1/admin/users/:id                                   fiche : statut, motif, nombre de courses, course en cours
  POST /v1/admin/users/:id/suspend { reason } | /reactivate  suspension immédiate (refusée pendant une course, pour un admin, pour soi-même)
  GET  /v1/admin/exports/trips.csv?from&to                   courses de la période (jours à Tunis, 366 max) ; journalisé
  GET  /v1/admin/exports/driver-earnings.csv?from&to         encaissé, commission, net, règlements et dette par chauffeur ; journalisé
  GET  /v1/admin/wallets/debts                               chauffeurs endettés, du plus au moins endetté, avec le plafond
  GET  /v1/admin/drivers/:id/wallet                          solde et mouvements d'un chauffeur
  POST /v1/admin/drivers/:id/wallet/settlements { amount, note? }   règlement d'une dette (jamais au-delà de la dette)
  POST /v1/admin/drivers/:id/wallet/adjustments { amount, reason }  correction signée et motivée (pénalité, erreur)
WebSocket (namespace /rt, JWT au handshake)
  client→serveur : driver:location
  serveur→client : trip:offer, trip:offer_expired, trip:updated, driver:location (vers le passager de la course), notification:new (boîte de réception)
```

## 8. Spécificités tunisiennes

**Téléphone.** Normalisation E.164, mobiles à 8 chiffres ; préfixes mobiles acceptés configurables (2x/4x/5x/9x, 3x) **[À VALIDER auprès des opérateurs]**.
SMS : un agrégateur local ou international avec routes directes Ooredoo / Orange / Tunisie Telecom. Coût et délivrabilité à tester (Sender ID alphanumérique à enregistrer). Interface `SmsProvider` : console en dev.

**Paiement.**
- *Cash* : mode par défaut. La commission de la plateforme sur une course payée en espèces devient une **dette** dans le wallet du chauffeur ; au-delà d'un plafond (ex. 50 TND), le chauffeur ne peut plus passer en ligne jusqu'au règlement. Les gains des courses payées en ligne compensent la dette.
- *En ligne (phase 2)* : Flouci (API marchand documentée), Konnect (agrège cartes locales, e-DINAR, wallets), ClicToPay (SMT, cartes locales via 3-D Secure). D17 : pas d'API marchand publique connue à ce jour **[À VALIDER avec La Poste]**.
- Cartes internationales : non prioritaire. Les cartes tunisiennes passent par les passerelles locales ; l'acquisition via un PSP étranger pose des questions de change **[À VALIDER juridiquement / BCT]**.

**Cartographie.** Recommandation à confirmer par un devis :
- Affichage : Google Maps SDK mobile (chargement des cartes mobiles non facturé à ce jour, mais vérifier la grille actuelle) ou Mapbox.
- Itinéraires / ETA pour la tarification : **OSRM auto-hébergé** sur l'extrait OpenStreetMap Tunisie → coût marginal nul, latence faible. La qualité OSM hors grandes villes est à vérifier sur échantillon.
- Autocomplétion : Google Places (sessions tokens pour limiter le coût) + cache des lieux fréquents (aéroports, gares, universités) ; alternative Photon/Nominatim auto-hébergé.

**Réseau faible.** Côté API : endpoints idempotents (`Idempotency-Key` sur `POST /trips`), positions envoyées par lots, état de course récupérable via `GET` après reconnexion (le WebSocket n'est qu'une accélération, jamais la source de vérité). Côté mobile : file d'envoi locale, retry exponentiel, cache du dernier état de course.

**Batterie chauffeur.** Fréquence GPS adaptative : 4 s en course, 10–15 s en ligne sans course, arrêt hors ligne ; filtre de distance minimale (≥ 10 m).

**Bilingue fr/ar.** Champs `locale` sur l'utilisateur, messages d'erreur API renvoyés sous forme de **codes** (`OTP_INVALID`…) traduits côté client, SMS envoyés dans la langue de l'utilisateur. UI en propriétés logiques (`start`/`end`) dès le départ.

## 9. Hébergement et données personnelles

La loi organique n° 2004-63 encadre les traitements de données personnelles (déclaration à l'INPDP) et soumet le **transfert à l'étranger** à autorisation **[À VALIDER juridiquement]**. Deux options :
- **Hébergeur local** (datacenters de Tunisie Telecom, Ooredoo, etc.) : conformité plus simple, latence minimale, offre managée plus limitée.
- **Cloud UE** (Paris / Milan / Francfort, ~30–50 ms depuis Tunis) : services managés, mais autorisation de transfert nécessaire.

L'architecture reste agnostique (conteneurs Docker, Postgres/Redis standards) : on peut démarrer sur un cloud UE en préproduction et basculer en local en production si le juriste l'exige.

## 10. Sécurité

- OTP : 6 chiffres, `crypto.randomInt`, stocké **haché** dans Redis (TTL 5 min), 5 tentatives max, limites d'envoi par numéro (1/min, 5/h) et par IP.
- Refresh tokens : opaques, stockés hachés, rotation à chaque usage ; réutilisation d'un token révoqué ⇒ révocation de toutes les sessions de l'utilisateur.
- Chiffrement applicatif des pièces d'identité ; documents stockés en objet privé (S3-compatible) avec URLs signées courtes.
- Positions GPS historiques conservées uniquement pendant les courses, purge programmée (durée à fixer avec le juriste).

## 11. Plan

- **Phase 1 (en cours)** : auth, profils, onboarding chauffeur minimal, présence et positions, devis, demande de course, matching séquentiel. ✅
- **Phase 1b** : cycle complet de la course (arrivé → démarré → terminé), paiement cash + wallet chauffeur, notation, upload des documents, app mobile (Expo).
- **Phase 2** : Flouci/Konnect, notifications push/SMS, back-office Next.js, zones et surge.
- **Phase 3** : partage de trajet, SOS, multi-arrêts, réservations planifiées, parrainage, multi-catégories, chat masqué, ML (demande, fraude).
