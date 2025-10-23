

# Caisse Enregistreuse MCP Server

Expose l’API de **caisse.enregistreuse.fr** / **free-cash-register.net** sous forme d’outils **Model Context Protocol (MCP)**, accessibles via HTTP (Streamable) et/ou STDIO.

> Dernière mise à jour : 2025-10-17

---

## 🚀 Fonctionnalités

- **Ventes** : `sales_create` avec prise en charge des lignes catalogue et libres.
- **Données** (listes) : articles, rayons, groupes de rayons, clients, déclinaisons, livraisons, modes de paiement, caisses, zones de livraison, points relais, réductions, utilisateurs…
- **Serveur HTTP** : endpoint **POST `/mcp`** pour JSON‑RPC MCP Streamable + **GET `/health`** et **GET `/.well-known/mcp/manifest.json`**.
- **Sécurité** :
  - Garde côté **STDIO** : tous les tools sont protégés par session, sauf ceux explicitement en liste blanche (par défaut `auth_get_token`).
  - (Optionnel) Vérification de **token porteur** via env `MCP_TOKENS` si vous utilisez la couche `security.ts`.

---

## 🧱 Architecture (aperçu)

- `index.ts` — serveur HTTP Express + transport Streamable MCP.
- `stdio.ts` — serveur MCP en STDIO, garde d’auth globale, normalisation Zod pour les tools.
- `tools/auth.ts` — `auth_get_token` (POST `/workers/getAuthToken.php`).
- `tools/sales.ts` — `sales_create` (+ encodage `itemsList[]` pour legacy).
- `tools/data.ts` — helpers pour déclarer les tools *list_* des entités.
- `support/http.ts` — utilitaires `get`, `postForm`, parsing JSON/TXT, `API_BASE`.
- `support/httpServer.ts` — routes `/health` et le manifest MCP statique.
- `support/security.ts` — helpers de jeton HTTP (optionnel).
- `schemas.ts` / `schemas-json.ts` — schémas (Zod / JSON) des entités côté client.

> NB : les imports ESM font référence à des chemins `./tools/*.js` et `./support/*.js` au **runtime** après build. Assurez‑vous que l’arborescence côté build reflète cette structure.

---

## ⚙️ Installation

Installation avec npx
```bash
npx caisse-enregistreuse-mcp-server --shopid=12345 --apikey=abcdef123456
```

Installation avec npm
```bash
# 1) Dépendances
npm install

# 2) Variables d'environnement (voir ci‑dessous)

# 3) Compilation
npm run build

# 4) Production
npm run stdio
```


### Variables d’environnement

| Variable        | Par défaut                              | Description |
|----------------|------------------------------------------|-------------|
| `APIKEY`         | `----`                                   | Nécessaire : votre clé API |
| `SHOPID`         | `----`                                   | Nécessaire : votre ID boutique |
| `PORT`         | `8787`                                   | Port HTTP du serveur |
| `API_BASE`     | `https://caisse.enregistreuse.fr`        | Base URL de l’API distante |
| `MCP_TOKENS`   | *(vide)*                                 | Liste de tokens HTTP autorisés, séparés par virgules (optionnel) |

Créez un fichier `.env` :
```env
PORT=8787
API_BASE=https://caisse.enregistreuse.fr
# Exemple si vous activez le garde HTTP:
MCP_TOKENS=token_prod_1,token_prod_2
```

---

## ▶️ Lancement

### Mode HTTP (Streamable MCP)

Le mode http nécessite un serveur redis.
Le serveur MCP http/Websocket est disponible à l'adresse https://mcp.enregistreuse.fr
- **POST** `https://mcp.enregistreuse.fr/mcp` avec un message JSON‑RPC MCP.
- **GET** `https://mcp.enregistreuse.fr/health` → `{ "status": "ok" }`
- **GET** `https://mcp.enregistreuse.fr/.well-known/mcp/manifest.json` → manifeste MCP


### Mode STDIO (utilisé pour Claude)
Le binaire/runner lance `src/stdio.ts` et parle MCP via stdin/stdout. La garde d’auth vérifie `ctx.auth` stocké en session (défini par `auth_get_token`).

---

## 🔐 Sécurité & Authentification

- **Étape 1** : appeler `auth_get_token` avec `login`/`password`. La réponse inclut `APIKEY` et `SHOPID`. Le serveur stocke en session :
  ```ts
  setSessionAuth({ ok: true, SHOPID, APIKEY, scopes: ['*'] })
  ```
- **Étape 2** : appeler les autres tools (ventes, données). La garde ré‑injecte la session dans le `ctx` de chaque handler et bloque si `auth.ok !== true` (sauf tools en whitelist).
- **Option HTTP** : si vous exposez publiquement `/mcp`, vous pouvez n’autoriser que des requêtes portant un **Bearer token** défini dans `MCP_TOKENS` (cf. `security.ts`).

---

## 🧪 Outils MCP disponibles (extraits)

### `auth_get_token`
- **Entrée** : `{{ login: string, password: string }}`
- **Sortie** : JSON brut renvoyé par `/workers/getAuthToken.php` (contient `APIKEY`, `SHOPID`)

### `sales_create`
Crée une vente. 

Entrée (shape Zod, champs principaux) :
- `shopId: string`, `apiKey: string`
- `payment: number`
- `deliveryMethod: 0|1|2|3|4|5|6`
- `idUser?: number | string`
- `idClient?: number | string`
- `idtable?: number | string`
- `idcaisse?: number | string`
- `numcouverts?: number | string`
- `publicComment?: string`
- `privateComment?: string`
- `pagerNum?: number | string`
- `client?: {{ firstname?, lastname?, email?, phone?, address?, zip?, city?, country? }}`
- `items: Array<
   {{ type:'catalog', productId?, quantity?, titleOverride?, priceOverride?, declinaisons? }}
   | {{ type:'dept', departmentId?, price?, title? }}
   | {{ type:'free', price?, title? }}
  >`

Encodage legacy des lignes :
- **Catalogue** : `productId_quantity_titleOverride_priceOverride_[...declinaisons]`
- **Vente en rayon** : `-<departmentId>_<price>_<title>`
- **Ligne libre** : `Free_<price>_<title>`
→ Envoyées sous la forme `itemsList[]`.

### `data_list_*` (exemples)
- `data_list_articles`
- `data_list_departments`
- `data_list_department_groups`
- `data_list_clients`
- `data_list_declinaisons`
- `data_list_deliveries`
- `data_list_payments`
- `data_list_cashboxes`
- `data_list_delivery_zones`
- `data_list_relay_points`
- `data_list_discounts`
- `data_list_users`
- `data_list_tables`

Toutes acceptent : `{{ format=('json'|'csv'|'html') }}`.

---

## 🧾 Manifest MCP

Le manifest est servi à `/.well-known/mcp/manifest.json`. 

---

## 🐞 Débogage

- Les modules `support/http.ts` tracent les requêtes et les réponses (JSON/TXT).
- `stdio.ts` normalise automatiquement `inputSchema`/`outputSchema` en **ZodRawShape** si un tool ne fournit pas le format attendu par le SDK MCP.
- Les logs ressemblent à :
  ```
  [caisse][path] __dirname=...
  [caisse][env] API_BASE=... 
  [caisse][patch] GET /workers/getPaymentModes.php ...
  [caisse][patch] response {...}
  ```

---
## Clients compatibles

- ChatGPT (OpenAI) : via configuration MCP externe
- Claude (Anthropic) : via “Tools manifest URL”
- n8n / Flowise / LangChain : import via URL publique

---

## 🧩 MCP Manifest Endpoint

L’API MCP expose un manifeste JSON décrivant l’ensemble des outils disponibles
pour les clients compatibles (ChatGPT, Claude, n8n, etc.).

### URL publique du manifeste

https://mcp.enregistreuse.fr/.well-known/mcp/manifest.json

> 🗂️ Cette URL est celle à fournir au client MCP lors de la configuration du serveur.


## 📦 Déploiement

- Conteneurisez l’app (Node 20+ ESM). Exposez le port `PORT`.
- Servez `/mcp` derrière un proxy TLS (Caddy, Nginx) si public.
- Gérez les secrets (`MCP_TOKENS`, `API_BASE`) via variables d’environnement.

---

## 📋 Licence

© 2025. GNU GENERAL PUBLIC LICENSE
