[![smithery badge](https://smithery.ai/badge/paracetamol951/kash)](https://smithery.ai/servers/paracetamol951/kash)

# 🧾 Kash MCP Server

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Demo-online-brightgreen.svg)](https://mcp.kash.click)
[![GitHub Stars](https://img.shields.io/github/stars/paracetamol951/caisse-enregistreuse-mcp-server?style=social)](https://github.com/paracetamol951/caisse-enregistreuse-mcp-server/stargazers)
[![npm](https://img.shields.io/npm/v/caisse-enregistreuse-mcp-server)](https://www.npmjs.com/package/caisse-enregistreuse-mcp-server)

[![Kash MCP](./ChatGPT-MCP.png)](https://www.youtube.com/watch?v=PpkrUfEy4ns)

**Kash MCP Server** is the official [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for **[Kash](https://kash.click)** — a free, cloud-based POS, invoicing, CRM and webshop platform trusted by thousands of merchants since 2011.

Connect your Kash account to **Claude, ChatGPT, n8n**, or any MCP-compatible AI — and manage your entire business through natural conversation.

> 🟢 Hosted server: [https://mcp.kash.click](https://mcp.kash.click)  
> 📖 Full documentation: [kash.click/cash-register-software](https://kash.click/cash-register-software/)

---

## ✨ What you can do

Just talk. No menus, no clicks.

```
"Record a sale of 2 coffees and 1 croissant at table 84"
"Show me this week's revenue report"
"Add a new item called Summer Tart at €4.50 in the Pastries department"
"Who are my best customers this month?"
"Create a Kash account for my restaurant"
"Record the card payment for order #1042"
"Add a Large size option to the Size variation"
```

---

## 🚀 Features

### 🔐 Account & Authentication — no config required
- **Create** a new Kash account directly from the conversation
- **List** accounts linked to an email to check if one already exists
- **Login via OTP** — a one-time password is sent to your email, no password needed
- **Logout** to clear the session at any time

### 🧾 Sales & Orders
- **Record sales** with catalog items, department lines, or free lines
- **Edit orders** — add items, assign a client, record payments, validate as invoice
- **List orders** by date range, validated or unvalidated, filtered by delivery method
- **Get order details** — full breakdown of items, client, payments and totals

### 📊 Reports
- **Sales report** — HTML summary for any period: a specific day, month, or full year (defaults to yesterday)

### 📦 Catalog Management
- **Items (PLU)**: add, edit, delete — with price, department, VAT, barcode, stock, variations...
- **Departments**: add, edit, delete — with VAT, price, group, variations...
- **Department groups**: add, edit, delete — to organize your catalog
- **VAT rates**: add, edit, delete
- **Variations**: add, edit, delete (e.g. "Size", "Color")
- **Variation choices**: add, edit, delete (e.g. "S", "M", "L" for "Size") with optional price delta

### 👥 Customer Management (CRM)
- **Add, edit, delete** customers with full contact info, company details, VAT number, barcode, loyalty data, private notes, blacklist status...

### 📋 Data & Lists
Retrieve any reference data from your shop:

| Tool | Data |
|---|---|
| `data_list_products` | Items / articles |
| `data_list_departments` | Departments / categories |
| `data_list_department_groups` | Department groups |
| `data_list_vats` | VAT rates |
| `data_list_clients` | Customers |
| `data_list_variations` | Variation types |
| `data_list_payments` | Payment methods |
| `data_list_cashboxes` | Cashboxes |
| `data_list_delivery_men` | Delivery methods |
| `data_list_delivery_zones` | Delivery zones |
| `data_list_relay_points` | Relay / pickup points |
| `data_list_discounts` | Discounts & supplements |
| `data_list_users` | Staff / users |
| `data_list_tables` | Tables (restaurant mode) |
| `data_list_orders` | Orders by date range |

---

## 🛠 Available Tools (46)

| Category | Tools |
|---|---|
| **Account** | `account_list`, `account_create` |
| **Auth** | `auth_request_otp`, `auth_login_with_otp`, `auth_logout` |
| **Sales** | `sale_create`, `order_edit`, `order_detail`, `data_list_orders`, `data_list_pending_orders` |
| **Reports** | `report_get` |
| **Items** | `plu_add`, `plu_edit`, `plu_delete`, `data_list_products` |
| **Departments** | `dept_add`, `dept_edit`, `dept_delete`, `data_list_departments` |
| **Dept groups** | `dept_group_add`, `dept_group_edit`, `dept_group_delete`, `data_list_department_groups` |
| **VAT** | `vat_add`, `vat_edit`, `vat_delete`, `data_list_vats` |
| **Variations** | `variation_add`, `variation_edit`, `variation_delete`, `data_list_variations` |
| **Variation choices** | `variation_choice_add`, `variation_choice_edit`, `variation_choice_delete` |
| **Customers** | `client_add`, `client_edit`, `client_delete`, `data_list_clients` |
| **Data** | `data_list_payments`, `data_list_cashboxes`, `data_list_delivery_men`, `data_list_delivery_zones`, `data_list_relay_points`, `data_list_discounts`, `data_list_users`, `data_list_tables` |
| **Utility** | `ping` |

---

## ⚙️ Prerequisites

You need a [Kash / free-cash-register.net](https://kash.click) account.

**Don't have one?** You can create it directly from the conversation using `account_create`, or register at [kash.click/free-pos-software](https://kash.click/free-pos-software/).

**Already have one?** Retrieve your `APIKEY` and `SHOPID` in the software under **Setup → Webservices** or connect using oAuth.

---

## 🔌 Option 1 — Hosted server (recommended)

The easiest way: connect directly to the hosted MCP server at `https://mcp.kash.click/mcp`.

No installation needed. Authentication is handled via OAuth 2.0 with PKCE.

### Claude.ai

In **Settings → Integrations**, add a new connector:

| Field | Value |
|---|---|
| Name | `Kash` |
| MCP Server URL | `https://mcp.kash.click/mcp` |
| Authentication | `OAuth` |

### ChatGPT

In **Settings → Connectors → Create Connector**:

| Field | Value |
|---|---|
| Name | `Kash POS` |
| MCP Server URL | `https://mcp.kash.click/mcp` |
| Authentication | `OAuth` |

### Smithery

Available on [smithery.ai](https://smithery.ai/servers/paracetamol951/kash) — search for **Kash**.

---

## 💻 Option 2 — Self-hosted (STDIO)

Run the server locally for Claude Desktop or any STDIO-based MCP client.

### Quick start via npx

```bash
npx caisse-enregistreuse-mcp-server --shopid=YOUR_SHOPID --apikey=YOUR_APIKEY
```

### Claude Desktop configuration

Edit `claude_desktop_config.json`:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "kash": {
      "command": "npx",
      "args": [
        "caisse-enregistreuse-mcp-server",
        "--shopid=YOUR_SHOPID",
        "--apikey=YOUR_APIKEY"
      ]
    }
  }
}
```

Or using environment variables:

```json
{
  "mcpServers": {
    "kash": {
      "command": "node",
      "args": ["PATH_TO_BUILD/build/stdio.js"],
      "cwd": "PATH_TO_BUILD",
      "env": {
        "SHOPID": "YOUR_SHOPID",
        "APIKEY": "YOUR_APIKEY"
      }
    }
  }
}
```

### Install from source

```bash
# 1) Clone
git clone https://github.com/paracetamol951/caisse-enregistreuse-mcp-server.git
cd caisse-enregistreuse-mcp-server

# 2) Install dependencies
npm install

# 3) Create .env
echo "SHOPID=YOUR_SHOPID" > .env
echo "APIKEY=YOUR_APIKEY" >> .env

# 4) Build
npm run build

# 5) Run
node build/stdio.js
```

### Docker (HTTP mode)

HTTP mode requires Redis. Use Docker Compose:

```bash
docker compose up
```

Or run manually:

```bash
docker run -d -p 6379:6379 redis
npm run dev
```

---

## 🔐 Authentication flow

### Hosted server (OAuth)
Authentication is handled automatically by the OAuth 2.0 + PKCE flow when you connect through Claude.ai, ChatGPT, or Smithery.

### In-conversation authentication (OTP)
You can also authenticate directly within the conversation — no password required:

```
1. auth_request_otp(email)         → OTP sent to your inbox
2. auth_login_with_otp(email, otp) → session initialized ✓
3. auth_logout()                   → clear session when done
```

If you don't have an account yet:

```
1. account_list(email)             → check existing accounts
2. account_create(email, title)    → create + session auto-initialized ✓
```

### STDIO / self-hosted
Pass credentials via CLI args or environment variables — `SHOPID` and `APIKEY`.

---

## 📡 API endpoints

| Endpoint | Description |
|---|---|
| `POST https://mcp.kash.click/mcp` | MCP JSON-RPC endpoint |
| `GET https://mcp.kash.click/health` | Health check → `{ "status": "ok" }` |
| `GET https://mcp.kash.click/.well-known/mcp/manifest.json` | MCP manifest (tool list) |
| `GET https://mcp.kash.click/.well-known/openid-configuration` | OAuth discovery |

---

## 🌍 Internationalization

Tool titles and descriptions are available in **English** and **French**, resolved automatically from the `Accept-Language` header or the `MCP_LANG` environment variable.

Locale files: `locales/en/common.json`, `locales/fr/common.json`

---

## Demo credentials

If you want to try the tool without creating an account, you can use the following credentials

Login: Demo15
Password : demodemo

---

## 💻 Compatible clients

| Client | Mode |
|---|---|
| Claude.ai | HTTP / OAuth |
| Claude Desktop | STDIO |
| ChatGPT | HTTP / OAuth |
| n8n | HTTP |
| Flowise / LangChain | HTTP |
| Smithery | HTTP / OAuth |
| Any MCP client | STDIO or HTTP |

---

## 🏪 Supported business types

When creating an account with `account_create`, use `configType` to pre-load a dataset tailored to your business:

`Bar` · `Bakery` · `Restaurant` · `Fast-food` · `Cafe` · `Coffee-shop` · `Pizzeria` · `Brewery` · `Food-truck` · `Snack` · `Florist` · `Retail` · `Pharmacy` · `Supermarket` · `Clothing-store` · `Ecommerce` · `Services` · `Beauty-institute` · `Coiffeur` · `Market` · `Library` · `Camping` · and more...

---

## 🔗 Links

- 🌐 **Website**: [kash.click](https://kash.click)
- 📖 **Documentation**: [kash.click/cash-register-software](https://kash.click/cash-register-software/)
- 🔧 **API Reference**: [kash.click/cash-register-software/mcp](https://kash.click/cash-register-software/mcp/)
- 🆓 **Register for free**: [kash.click/free-pos-software](https://kash.click/free-pos-software/)

---

## 📋 License

© 2025 Net-assembly. [GNU General Public License v3.0](LICENSE)