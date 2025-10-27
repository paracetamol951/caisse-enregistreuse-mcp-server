# 🧾 Caisse Enregistreuse MCP Server

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Demo-online-brightgreen.svg)](https://mcp.enregistreuse.fr)
[![GitHub Stars](https://img.shields.io/github/stars/paracetamol951/caisse-enregistreuse-mcp-server?style=social)](https://github.com/paracetamol951/caisse-enregistreuse-mcp-server/stargazers)

![Caisse MCP](./ChatGPT-MCP.png)

**Caisse Enregistreuse MCP Server** is a server compliant with the **MCP (Model Context Protocol)**, allowing ChatGPT, Claude, and other MCP-compatible clients to connect to a **sales recorder system** (or POS, cash register).

It provides a simple interface to:
- 📊 View sales and revenue  
- 🧾 Create and record receipts  
- 🛒 Manage products and stock  
- 🧠 Generate automated reports through conversational requests  

> 🟢 Live Server: [https://mcp.enregistreuse.fr](https://mcp.enregistreuse.fr)

---

**Connect your cash register to ChatGPT, Claude, or n8n — and manage your business simply by talking.**

![Caisse MCP](./doc/ChatGPT-Screen.png)

Imagine your cash register understanding your sentences, executing your commands, and analyzing your reports — without a single click.  
With this intelligent gateway, the **caisse.enregistreuse.fr** software becomes compatible with ChatGPT, Claude, and n8n, transforming your interactions into concrete actions.  
Just say “record an order for two coffees at table 4” or “show me the invoice for order 125” — and it’s done.  

You can also ask “what’s my revenue for this week?” or “who are my best customers on Tuesdays?”.  
Your favorite assistant communicates directly with your cash register and responds instantly.  
This is a new way to run your business: smoother, faster, and incredibly natural.  
Your **voice becomes your interface**, and your **assistant becomes your new coworker**.

This project exposes the **caisse.enregistreuse.fr** / **free-cash-register.net** API as **Model Context Protocol (MCP)** tools, available over **HTTP (Streamable)** and/or **STDIO**.

> Last updated: 2025-10-17

---

## 🚀 Features

- **Sales**: `sale_create` with support for catalog and free lines.
- **Data** (lists): products, departments, department groups, clients, variations, deliveries, payment methods, cashboxes, delivery zones, relay points, discounts, users…
- **HTTP Server**: endpoints  
  - **POST** `/mcp` for JSON-RPC MCP Streamable  
  - **GET** `/health`  
  - **GET** `/.well-known/mcp/manifest.json`
- **Security**:
  - Guard on **STDIO**: all tools are session-protected, except those explicitly whitelisted (by default `health.ping`).
  - (Optional) **Bearer token** validation via `MCP_TOKENS` environment variable if using the `security.ts` layer.

---

## 🔹 Example usage (ChatGPT / Claude MCP)

- 💬 “Show me today’s sales”  
- 💬 “Record a sale of 2 coffees and 1 croissant at table 84”  
- 💬 “Ten red roses to deliver to Mrs. Dupond at 6:15 PM!”  
- 💬 “Generate a cash register report for the week”  
- 💬 “Have takeaway sales increased this year?”  
- 💬 “Did customer Dupont pay for their order?”

---

## ⚙Prerequisities

You need to have a free-cash-register.net account.
If you don't have one, you can register at :
https://www.free-cash-register.net/free-pos-software/

Then in the software, you have to get your APIKEY and SHOPID in Setup, Webservices page.

---

## ⚙️ Installation

### Claude

#### Install via npx

Create an installation folder and run the following command in your shell:

```bash
npx caisse-enregistreuse-mcp-server --shopid=12345 --apikey=abcdef123456
```

#### Install via npm

```bash
# 1) Dependencies
npm install

# 2) Environment variables (see below)

# 3) Build
npm run build
```

#### Configuration

The binary/runner launches `src/stdio.ts` and communicates via MCP stdin/stdout.  
Edit the file `claude_desktop_config.json` in your Claude Desktop configuration directory:

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Customize the installation path and set your SHOPID and APIKEY (retrieve them from [https://caisse.enregistreuse.fr](https://caisse.enregistreuse.fr)):

```json
{
  "mcpServers": {
    "caisse": {
      "command": "node",
      "args": [
        "{{PATH_TO_SRC}}/build/stdio.js"
      ],
      "cwd": "{{PATH_TO_SRC}}",
      "env": {
        "SHOPID": "16",
        "APIKEY": "XXXXXXXX"
      }
    }
  }
}
```

### ChatGPT

> Requires a workspace account

In **Settings → Connectors → Create Connector**, fill in the following:

| Variable | Value |
|-----------|--------|
| `Name` | `Caisse enregistreuse` |
| `Description` | `Can record sales from your catalog and retrieve your sales reports. POS software integration.` |
| `MCP Server URL` | `https://mcp.enregistreuse.fr/mcp` |
| `Authentication` | `oAuth` |

Once added, the connector will be **available in new conversations**.

---

### Environment variables

| Variable | Default | Description |
|-----------|----------|-------------|
| `APIKEY` | `----` | Required: your API key |
| `SHOPID` | `----` | Required: your shop ID |
| `PORT` | `8787` | HTTP server port |
| `API_BASE` | `https://caisse.enregistreuse.fr` | Base URL of the remote API |
| `MCP_TOKENS` | *(empty)* | Optional: list of authorized HTTP tokens, comma-separated |

Create a `.env` file:

```env
PORT=8787
API_BASE=https://caisse.enregistreuse.fr
# Example if enabling HTTP guard:
MCP_TOKENS=token_prod_1,token_prod_2
```

---

## ▶️ Launch

### HTTP Mode (Streamable MCP)

The HTTP mode requires a Redis server.  
It is recommended to use the hosted MCP HTTP/WebSocket server available at [https://mcp.enregistreuse.fr](https://mcp.enregistreuse.fr):

- **POST** `https://mcp.enregistreuse.fr/mcp` with a JSON-RPC MCP message  
- **GET** `https://mcp.enregistreuse.fr/health` → `{ "status": "ok" }`  
- **GET** `https://mcp.enregistreuse.fr/.well-known/mcp/manifest.json` → MCP manifest  

---

## 🧪 Available MCP Tools (excerpt)

### `sale_create`
Creates a sale.

Input (Zod schema, main fields):
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

Legacy item encoding:
- **Catalog**: `productId_quantity_titleOverride_priceOverride_[...declinaisons]`
- **Department sale**: `-<departmentId>_<price>_<title>`
- **Free line**: `Free_<price>_<title>`
→ Sent as `itemsList[]`.

### `data_list_*` (examples)
- `data_list_products`
- `data_list_departments`
- `data_list_department_groups`
- `data_list_clients`
- `data_list_variations`
- `data_list_delivery_men`
- `data_list_payments`
- `data_list_cashboxes`
- `data_list_delivery_zones`
- `data_list_relay_points`
- `data_list_discounts`
- `data_list_users`
- `data_list_tables`

All accept: `{{ format=('json'|'csv'|'html') }}`.

---

## 💻 Compatible Clients

- **ChatGPT (OpenAI)** — via external MCP configuration  
- **Claude (Anthropic)** — via “Tools manifest URL”  
- **n8n / Flowise / LangChain** — import via public URL  

---

## 🧩 MCP Manifest Endpoint

The MCP API exposes a JSON manifest describing all available tools for compatible clients (ChatGPT, Claude, n8n, etc.).

### Public manifest URL

https://mcp.enregistreuse.fr/.well-known/mcp/manifest.json

> 🗂️ This URL is the one to provide to your MCP client when configuring the server.

---

## 📋 License

© 2025. GNU GENERAL PUBLIC LICENSE
