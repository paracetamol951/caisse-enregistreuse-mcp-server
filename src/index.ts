import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAuthTools } from './tools/auth.js';
import { registerSalesTools } from './tools/sales.js';
import { registerDataTools } from './tools/data.js';
import { registerVatTools } from './tools/vats.js';
import { registerCatalogTools } from './tools/catalog.js';
import { setSessionAuth, runWithSession, updateSessionId } from './context.js';
import { loadSessionAuth } from './support/session-store.js';
import { initStore } from './support/store.js';
import { registerPrompts } from './prompts/index.js';
import oauthRouter, { bearerValidator } from './support/oauth.js';
import { registerClientTools } from './tools/clients.js';
import { registerResources } from './resources/index.js';
import { registerPaymentModeTools } from './tools/payment_modes.js';

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, viewport-fit=cover">
<title>Kash — AI Invoicing and POS Assistant for ChatGPT, Claude and MCP Tools</title>
<meta name="description" content="Kash is an AI invoicing and POS assistant. Create invoices first, then manage orders, inventory and customers from ChatGPT, Claude, n8n or any MCP-compatible tool — in plain language. Free for all Kash accounts.">
<meta name="keywords" content="create invoice with ChatGPT, AI invoicing, MCP server, Kash POS, invoice automation, Claude MCP, n8n automation, AI business management, inventory management, online cash register, free POS software">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://mcp.kash.click">
<link rel="alternate" hreflang="en" href="https://mcp.kash.click">
<link rel="alternate" hreflang="fr" href="https://mcp.caisse.enregistreuse.fr">
<link rel="alternate" hreflang="x-default" href="https://mcp.kash.click">

<!-- Open Graph -->
<meta property="og:title" content="Kash — AI Invoicing and POS Assistant">
<meta property="og:description" content="Create invoices first, then manage orders, inventory and customers from ChatGPT, Claude, n8n or any MCP-compatible tool — in plain language.">
<meta property="og:url" content="https://mcp.kash.click">
<meta property="og:site_name" content="kash.click">
<meta property="og:image" content="https://kash.click/PreviewEN.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_US">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Kash — AI Invoicing and POS Assistant">
<meta name="twitter:description" content="Create invoices first, then manage orders, inventory and customers from ChatGPT, Claude, n8n or any MCP-compatible tool — in plain language.">
<meta name="twitter:image" content="https://kash.click/PreviewEN.png">

<!-- Favicons -->
<link rel="shortcut icon" type="image/ico" href="https://kash.click/favicon.ico">
<link rel="apple-touch-icon" href="https://kash.click/ios/AppIcon.appiconset/Icon-60@2x.png">
<link rel="apple-touch-icon" sizes="180x180" href="https://kash.click/ios/AppIcon.appiconset/Icon-60@3x.png">
<link rel="manifest" href="https://kash.click/manifesten.json">

<!-- Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">

<!-- JSON-LD Structured Data -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://mcp.kash.click/#software",
      "name": "Kash AI Invoicing and POS Assistant",
      "description": "AI invoicing and POS assistant for Kash — create invoices first, then manage orders, inventory and customers from Claude, ChatGPT, n8n or any MCP-compatible AI tool in plain language.",
      "url": "https://mcp.kash.click",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      },
      "publisher": {
        "@type": "Organization",
        "name": "kash.click",
        "url": "https://kash.click"
      }
    },
    {
      "@type": "WebPage",
      "@id": "https://mcp.kash.click/#webpage",
      "url": "https://mcp.kash.click",
      "name": "Kash — AI Invoicing and POS Assistant",
      "description": "Create invoices first, then manage orders, inventory and customers from Claude, ChatGPT, n8n or any MCP-compatible tool — in plain language.",
      "inLanguage": "en",
      "isPartOf": { "@id": "https://kash.click/#website" }
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Can I create invoices with ChatGPT or Claude using Kash?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes. The Kash MCP server lets compatible AI tools such as ChatGPT, Claude and n8n create invoices, retrieve customers, add invoice lines, check required business information and access Kash data through a secure OAuth connection."
          }
        },
        {
          "@type": "Question",
          "name": "What is the Kash MCP server?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "The Kash MCP server is a Model Context Protocol endpoint that lets any compatible AI tool read and write data in your Kash account — invoices, orders, customers, products, inventory and settings."
          }
        },
        {
          "@type": "Question",
          "name": "Is the Kash MCP server free?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes. The MCP server is included with all Kash accounts at no extra cost."
          }
        },
        {
          "@type": "Question",
          "name": "Which AI tools are compatible with the Kash MCP server?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Any tool that supports the Model Context Protocol: Claude, ChatGPT, n8n and other MCP-compatible clients or automation platforms."
          }
        }
      ]
    }
  ]
}
</script>

<style>
/* ── KASH BASE STYLES (original) ──────────────────────── */
:root{--animate-duration:1s;--animate-delay:1s;--animate-repeat:1;}
*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:#e5e7eb;}
html{line-height:1.5;-webkit-text-size-adjust:100%;font-family:ui-sans-serif,system-ui,sans-serif;-webkit-tap-highlight-color:transparent;}
body{margin:0;line-height:inherit;}
h1,h2,h3,h4{font-size:inherit;font-weight:inherit;margin:0 0 .5rem;}
a{color:inherit;text-decoration:inherit;}
p{margin:0 0 1rem;}
img,svg{display:block;vertical-align:middle;}
img{max-width:100%;height:auto;}
.container{width:100%;margin-right:auto;margin-left:auto;padding-right:15px;padding-left:15px;}
@media(min-width:576px){.container{max-width:540px;}}
@media(min-width:768px){.container{max-width:720px;}}
@media(min-width:992px){.container{max-width:960px;}}
@media(min-width:1200px){.container{max-width:1140px;}}
@media(min-width:1400px){.container{max-width:1320px;}}
.flex{display:flex;} .inline{display:inline;}
.fixed{position:fixed;} .absolute{position:absolute;}
.w-full{width:100%;} .shrink-0{flex-shrink:0;} .grow{flex-grow:1;}
.items-center{align-items:center;} .justify-between{justify-content:space-between;}
.flex-wrap{flex-wrap:wrap;} .!flex-nowrap{flex-wrap:nowrap!important;}
.mr-8{margin-right:2rem;} .overflow-hidden{overflow:hidden;}
.px-\[15px\]{padding-left:15px;padding-right:15px;}

:root{font-size:20px;}
::selection{background-color:rgba(63,120,224,.7);color:#fff;}
a{transition:all .2s cubic-bezier(0.4,0,0.2,1);}
a:focus{outline:0;}
h1,h2,h3,h4{margin-top:0;font-weight:700;letter-spacing:-.01rem;color:#343f52;word-spacing:.1rem;}
h2{line-height:1.35;}
h3,h4{line-height:1.4!important;}
body,html{height:100%;}
body{display:flex;flex-direction:column;margin:0;background-color:#fefefe;font-family:"Space Grotesk",sans-serif!important;font-size:.85rem!important;font-weight:500;line-height:1.7;color:#60697b;overflow-x:hidden;-webkit-font-smoothing:antialiased;word-spacing:.05rem;}

/* ── KASH NAVBAR ──────────────────────────────────────── */
.navbar{position:relative;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:0;color:#343f52;z-index:1020;width:100%;}
.navbar>.container{display:flex;align-items:center;justify-content:space-between;flex-wrap:inherit;}
.navbar-brand{margin-right:0;white-space:nowrap;padding:0;font-size:.7rem;color:#3f78e0;}
.navbar-brand:hover{color:#3f78e0;}
.navbar-collapse{flex-grow:1;flex-basis:100%;align-items:center;display:flex;justify-content:flex-end;}
.navbar-clone{position:fixed!important;left:0;top:0;z-index:1008;transform:translateY(-100%);transition:transform .3s ease-in-out,background .3s,box-shadow .3s;background:rgba(255,255,255,0);padding:0!important;}
.logoC{width:38px;}
.kash{width:171px;height:auto;margin-left:20px;}
@media(min-width:992px){
  .navbar-expand-lg{flex-wrap:nowrap;justify-content:flex-start;}
  .navbar-expand-lg .navbar-collapse{display:flex;flex-basis:auto;}
  .navbar-expand-lg.transparent:not(.navbar-clone){padding-top:.3rem;}
  .navbar-expand-lg.transparent.navbar-clone{padding-top:0;}
}
@media(max-width:991.98px){
  .navbar-expand-lg .navbar-brand{padding-top:1.2rem;padding-bottom:1.2rem;}
}

/* ── DESIGN TOKENS ────────────────────────────────────── */
:root{
  --blue:#3f78e0; --blue-dk:#2d5fc7; --blue-lt:#eef3fd; --blue-md:#c5d8f8;
  --green:#16a34a; --green-lt:#ecfdf5; --amber:#d97706; --amber-lt:#fffbeb;
  --ink:#1e2433; --ink2:#343f52; --mut:#60697b; --sub:#8a94a6;
  --bdr:rgba(8,60,130,0.08); --bg:#f7f9fc; --wh:#ffffff;
  --mono:'DM Mono',monospace;
  --r:12px;
  --sh:0 4px 20px rgba(30,36,50,0.08),0 0 0 1px rgba(8,60,130,0.05);
  --shlg:0 12px 40px rgba(30,36,50,0.12),0 0 0 1px rgba(8,60,130,0.06);
}
#NEWUI{flex:1 0 0%;}

/* ── HERO ─────────────────────────────────────────────── */
.hero{padding:112px 24px 80px;background:linear-gradient(155deg,#eef3fd 0%,#f7f9fc 45%,#fff 100%);position:relative;overflow:hidden;}
.hero::before{content:'';position:absolute;top:-100px;right:-60px;width:560px;height:560px;background:radial-gradient(circle,rgba(63,120,224,.08) 0%,transparent 70%);pointer-events:none;}
.hero-in{max-width:1140px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;}
.eyebrow{display:inline-flex;align-items:center;gap:8px;background:var(--blue-lt);color:var(--blue);font-size:.7rem;font-weight:700;padding:5px 14px;border-radius:20px;letter-spacing:.04em;margin-bottom:18px;border:1px solid var(--blue-md);}
.eyebrow::before{content:'';width:7px;height:7px;background:var(--blue);border-radius:50%;animation:pulse 2s ease infinite;}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(.65);}}
.hero h1{font-size:2.6rem;font-weight:700;line-height:1.18;color:var(--ink);letter-spacing:-.03em;margin-bottom:16px;}
.hero h1 em{font-style:normal;color:var(--blue);}
.hero-lead{font-size:.96rem;line-height:1.65;color:var(--mut);margin-bottom:19px;max-width:500px;}
.hero-proof{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:24px;}
.proof{display:inline-flex;align-items:center;gap:7px;background:var(--wh);border:1px solid var(--bdr);border-radius:12px;padding:8px 12px;font-size:.72rem;font-weight:700;color:var(--ink2);box-shadow:0 1px 3px rgba(30,36,50,0.06);}
.proof svg{flex-shrink:0;}

/* AI tool badges */
.ai-badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:28px;}
.ai-badges span{font-size:.7rem;color:var(--sub);font-weight:600;margin-right:2px;}
.ai-badge{display:inline-flex;align-items:center;gap:5px;background:var(--wh);border:1px solid var(--bdr);border-radius:20px;padding:4px 11px;font-size:.72rem;font-weight:600;color:var(--ink2);box-shadow:0 1px 3px rgba(30,36,50,0.06);}

.ha{display:flex;gap:12px;flex-wrap:wrap;}
.bp{display:inline-flex;align-items:center;gap:7px;background:var(--blue);color:#fff;padding:11px 22px;border-radius:30px;font-weight:700;font-size:.82rem;transition:background .2s,transform .15s,box-shadow .2s;}
.bp:hover{background:var(--blue-dk);transform:translateY(-2px);box-shadow:0 8px 20px rgba(63,120,224,.3);}
.bs{display:inline-flex;align-items:center;gap:7px;border:1.5px solid var(--bdr);color:var(--ink2);padding:11px 22px;border-radius:30px;font-weight:600;font-size:.82rem;transition:border-color .2s,background .2s,color .2s;}
.bs:hover{border-color:var(--blue);color:var(--blue);background:var(--blue-lt);}

/* HERO DEMO */
.hdemo{background:var(--wh);border-radius:18px;box-shadow:var(--shlg);overflow:hidden;border:1px solid var(--bdr);}
.dtb{background:#1e2433;padding:13px 17px;display:flex;align-items:center;gap:10px;}
.dots{display:flex;gap:6px;}
.dots span{width:11px;height:11px;border-radius:50%;}
.dots span:nth-child(1){background:#ff5f57;} .dots span:nth-child(2){background:#febc2e;} .dots span:nth-child(3){background:#28c840;}
.dtitle{color:rgba(255,255,255,.4);font-size:.7rem;font-family:var(--mono);margin-left:4px;}
.dbody{padding:17px 15px;display:flex;flex-direction:column;gap:11px;}

/* ── CHAT BUBBLES ─────────────────────────────────────── */
.cm{display:flex;gap:8px;align-items:flex-start;}
.cm.u{flex-direction:row-reverse;}
.cav{width:29px;height:29px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.63rem;font-weight:700;flex-shrink:0;}
.cm.ai .cav{background:var(--blue);color:#fff;}
.cm.u .cav{background:var(--ink2);color:#fff;}
.cb{max-width:83%;padding:8px 12px;border-radius:11px;font-size:.77rem;line-height:1.55;}
.cm.ai .cb{background:var(--bg);color:var(--ink2);border-radius:3px 11px 11px 11px;}
.cm.u .cb{background:var(--blue);color:#fff;border-radius:11px 3px 11px 11px;}
.cb strong{font-weight:700;}
.cb .pill{display:inline-flex;align-items:center;gap:5px;background:var(--blue-lt);color:var(--blue);border-radius:6px;padding:3px 8px;font-size:.69rem;font-weight:600;margin-top:5px;border:1px solid var(--blue-md);}
.cb .warn{background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:7px 10px;margin-top:5px;font-size:.74rem;color:#78350f;line-height:1.5;}
.cb .ok{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;padding:7px 10px;margin-top:5px;font-size:.74rem;color:#14532d;line-height:1.5;}
.invoice-mini{background:#fff;border:1px solid var(--bdr);border-radius:10px;padding:10px;margin-top:7px;font-family:var(--mono);font-size:.66rem;color:var(--ink2);}
.invoice-mini div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed rgba(8,60,130,.12);padding:3px 0;}
.invoice-mini div:last-child{border-bottom:0;font-weight:700;color:var(--blue);}

/* ── SECTIONS ─────────────────────────────────────────── */
.sec{padding:84px 24px;}
.sec.bg-g{background:var(--bg);}
.sec.bg-w{background:var(--wh);}
.sec.bg-d{background:var(--ink);}
.sin{max-width:1140px;margin:0 auto;}
.sh{text-align:center;margin-bottom:52px;}
.se{display:inline-block;color:var(--blue);font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:9px;}
.sh h2{font-size:1.85rem;font-weight:700;color:var(--ink);letter-spacing:-.025em;line-height:1.25;margin-bottom:10px;}
.sh p{font-size:.92rem;color:var(--mut);max-width:570px;margin:0 auto;}

/* ── INVOICE FOCUS STRIP ──────────────────────────────── */
.invstrip{background:var(--wh);border-top:1px solid var(--bdr);border-bottom:1px solid var(--bdr);padding:24px;}
.invstrip-in{max-width:1140px;margin:0 auto;display:grid;grid-template-columns:1.2fr repeat(3,1fr);gap:14px;align-items:stretch;}
.inv-main{background:var(--ink);color:#fff;border-radius:16px;padding:22px 24px;box-shadow:var(--sh);}
.inv-main strong{display:block;font-size:.96rem;margin-bottom:5px;color:#fff;}
.inv-main span{display:block;font-size:.78rem;color:rgba(255,255,255,.62);line-height:1.6;}
.inv-card{background:var(--bg);border:1px solid var(--bdr);border-radius:16px;padding:18px;}
.inv-card b{display:block;color:var(--ink);font-size:.86rem;margin-bottom:5px;}
.inv-card p{margin:0;font-size:.76rem;line-height:1.55;color:var(--mut);}

/* ── COMPATIBLE TOOLS BANNER ──────────────────────────── */
.compat{background:var(--wh);border-top:1px solid var(--bdr);border-bottom:1px solid var(--bdr);padding:28px 24px;}
.compat-in{max-width:1140px;margin:0 auto;display:flex;align-items:center;gap:24px;flex-wrap:wrap;justify-content:center;}
.compat-label{font-size:.72rem;font-weight:700;color:var(--sub);letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;}
.compat-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;}
.ctool{display:inline-flex;align-items:center;gap:7px;background:var(--bg);border:1px solid var(--bdr);border-radius:10px;padding:8px 16px;font-size:.78rem;font-weight:600;color:var(--ink2);}
.compat-more{font-size:.75rem;color:var(--sub);font-style:italic;}

/* ── PERSONAS ─────────────────────────────────────────── */
.pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:13px;}
.pc{background:var(--wh);border:1px solid var(--bdr);border-radius:var(--r);padding:24px 20px;transition:transform .2s,box-shadow .2s;}
.pc:hover{transform:translateY(-3px);box-shadow:var(--sh);}
.pi{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:13px;}
.pc h3{font-size:.87rem;font-weight:700;color:var(--ink);margin-bottom:6px;}
.pc p{font-size:.78rem;line-height:1.6;margin:0;}

/* ── USE CASES ────────────────────────────────────────── */
.ucl{display:flex;flex-direction:column;gap:60px;}
.uc{display:grid;grid-template-columns:1fr 1fr;gap:52px;align-items:center;}
.uc.rv{direction:rtl;}
.uc.rv>*{direction:ltr;}
.utag{display:inline-block;background:var(--blue-lt);color:var(--blue);font-size:.67rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 11px;border-radius:20px;margin-bottom:13px;border:1px solid var(--blue-md);}
.utag.green{background:var(--green-lt);color:var(--green);border-color:#bbf7d0;}
.utag.amber{background:var(--amber-lt);color:var(--amber);border-color:#fde68a;}
.uct h3{font-size:1.3rem;font-weight:700;color:var(--ink);letter-spacing:-.025em;line-height:1.3;margin-bottom:11px;}
.uct p{font-size:.86rem;line-height:1.7;margin-bottom:14px;}
.ubl{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;}
.ubl li{display:flex;align-items:flex-start;gap:8px;font-size:.8rem;color:var(--mut);}
.ubl li::before{content:'';width:17px;height:17px;border-radius:50%;flex-shrink:0;margin-top:2px;background:#eef3fd url("data:image/svg+xml,%3Csvg width='10' height='8' viewBox='0 0 10 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 4L3.5 6.5L9 1' stroke='%233f78e0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center;}
.ucd{background:var(--wh);border-radius:16px;box-shadow:var(--sh);border:1px solid var(--bdr);overflow:hidden;}
.dh{background:var(--bg);padding:10px 14px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:7px;}
.dhd{width:7px;height:7px;background:var(--blue);border-radius:50%;}
.dhl{font-size:.68rem;font-weight:600;color:var(--sub);font-family:var(--mono);}
.dc{padding:15px 13px;display:flex;flex-direction:column;gap:10px;}

/* ── FEATURES ─────────────────────────────────────────── */
.fg{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;}
.fc{background:var(--wh);border:1px solid var(--bdr);border-radius:var(--r);padding:24px 20px;}
.fi{width:38px;height:38px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;}
.fc h4{font-size:.85rem;font-weight:700;color:var(--ink);margin-bottom:5px;}
.fc p{font-size:.78rem;line-height:1.6;margin:0;}

/* ── PROMPTS ──────────────────────────────────────────── */
.promptgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
.promptcard{background:var(--wh);border:1px solid var(--bdr);border-radius:16px;padding:20px;box-shadow:0 1px 3px rgba(30,36,50,0.04);}
.promptcard h3{font-size:.88rem;color:var(--ink);margin-bottom:10px;}
.promptcard ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;}
.promptcard li{font-size:.76rem;line-height:1.5;background:var(--bg);border:1px solid var(--bdr);border-radius:10px;padding:9px 10px;color:var(--ink2);}

/* ── HOW IT WORKS ─────────────────────────────────────── */
.hwrap{max-width:800px;margin:0 auto;}
.steps{display:grid;grid-template-columns:repeat(3,1fr);position:relative;}
.steps::before{content:'';position:absolute;top:26px;left:calc(16.66% + 14px);right:calc(16.66% + 14px);height:2px;background:var(--blue-md);}
.step{text-align:center;padding:0 16px;}
.sn{width:52px;height:52px;border-radius:50%;background:var(--blue);color:#fff;font-size:.95rem;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 15px;position:relative;z-index:1;}
.step h4{font-size:.87rem;font-weight:700;color:var(--ink);margin-bottom:5px;}
.step p{font-size:.78rem;line-height:1.6;margin:0;}
.urlbox{margin-top:44px;background:var(--bg);border-radius:var(--r);padding:22px 26px;border:1px solid var(--bdr);}
.urlbox label{font-size:.7rem;color:var(--sub);font-family:var(--mono);display:block;margin-bottom:7px;}
.urlrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.urlrow code{font-family:var(--mono);font-size:.84rem;color:var(--ink2);background:var(--wh);padding:9px 15px;border-radius:7px;border:1px solid var(--bdr);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* ── FAQ ──────────────────────────────────────────────── */
.faqlist{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:2px;}
.faqitem{background:var(--wh);border:1px solid var(--bdr);border-radius:var(--r);overflow:hidden;}
.faqq{width:100%;background:none;border:none;text-align:left;padding:18px 22px;font-family:"Space Grotesk",sans-serif;font-size:.88rem;font-weight:700;color:var(--ink);cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;}
.faqq:hover{background:var(--bg);}
.faqq svg{flex-shrink:0;transition:transform .25s;}
.faqitem.open .faqq svg{transform:rotate(45deg);}
.faqa{max-height:0;overflow:hidden;transition:max-height .3s ease,padding .3s ease;padding:0 22px;font-size:.82rem;line-height:1.7;color:var(--mut);}
.faqitem.open .faqa{max-height:240px;padding:0 22px 18px;}

/* ── CTA ──────────────────────────────────────────────── */
.ctain{max-width:680px;margin:0 auto;text-align:center;}
.ctain h2{font-size:2rem;font-weight:700;color:#fff;letter-spacing:-.03em;margin-bottom:12px;}
.ctain p{font-size:.92rem;color:rgba(255,255,255,.5);margin-bottom:28px;}
.ctabtns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}
.bw{display:inline-flex;align-items:center;gap:7px;background:#fff;color:var(--ink);padding:11px 24px;border-radius:30px;font-weight:700;font-size:.82rem;transition:transform .15s,box-shadow .2s;}
.bw:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.28);}
.bgo{display:inline-flex;align-items:center;gap:7px;border:1.5px solid rgba(255,255,255,.18);color:rgba(255,255,255,.7);padding:11px 24px;border-radius:30px;font-weight:600;font-size:.82rem;transition:border-color .2s,color .2s;}
.bgo:hover{border-color:rgba(255,255,255,.55);color:#fff;}

/* ── FOOTER ───────────────────────────────────────────── */
.ft{background:#1e2433;border-top:1px solid rgba(255,255,255,.07);padding:26px 24px;}
.ftin{max-width:1140px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;}
.ftlogo{display:flex;align-items:center;gap:0;}
.ftcopy{font-size:.7rem;color:rgba(255,255,255,.22);}

/* ── ANIMATIONS ───────────────────────────────────────── */
.fi0{opacity:0;transform:translateY(18px);transition:opacity .55s ease,transform .55s ease;}
.fi0.vis{opacity:1;transform:translateY(0);}

/* ── RESPONSIVE ───────────────────────────────────────── */
@media(max-width:900px){
  .hero-in{grid-template-columns:1fr;gap:32px;}
  .hero{padding:100px 20px 52px;}
  .hero h1{font-size:1.9rem;}
  .invstrip-in{grid-template-columns:1fr;}
  .uc{grid-template-columns:1fr;gap:26px;}
  .uc.rv{direction:ltr;}
  .fg,.promptgrid{grid-template-columns:repeat(2,1fr);}
  .steps{grid-template-columns:1fr;gap:32px;}
  .steps::before{display:none;}
  .ftin{flex-direction:column;text-align:center;}
}
@media(max-width:600px){
  .sec{padding:52px 16px;}
  .pgrid,.fg,.promptgrid{grid-template-columns:1fr;}
  .ctain h2{font-size:1.55rem;}
  .hero-proof{display:grid;grid-template-columns:1fr;}
}
</style>
</head>
<body>

<!-- ── NAVBAR CLONE (sticky) ──────────────────────────── -->
<nav class="navbar navbar-expand-lg center-nav transparent navbar-light caret-none navbar-clone" style="padding-top:env(safe-area-inset-top)!important" aria-label="Site navigation">
  <div class="container flex items-center justify-between !flex-nowrap px-[15px]">
    <div class="navbar-brand w-full">
      <a href="https://kash.click/" aria-label="Kash homepage">
        <img src="https://kash.click/assets/img/LogoCaisse.svg" class="inline logoC" alt="Kash POS logo">
        <img src="https://kash.click/assets/img/kash-logo4.svg" class="kash inline mr-8" alt="Kash">
      </a>
    </div>
    <div class="navbar-collapse">
      <a href="https://kash.click" class="bp" style="white-space:nowrap;flex-shrink:0;font-size:.78rem;padding:9px 20px;">Start invoicing →</a>
    </div>
  </div>
</nav>

<div id="NEWUI" class="grow shrink-0">

  <!-- ── HEADER NAV (original Kash structure) ─────────── -->
  <header>
    <nav class="navbar navbar-expand-lg center-nav transparent navbar-light caret-none absolute" style="padding-top:env(safe-area-inset-top)!important" aria-label="Primary navigation">
      <div class="container flex items-center justify-between !flex-nowrap px-[15px]">
        <div class="navbar-brand w-full">
          <a href="https://kash.click/" aria-label="Kash homepage">
            <img src="https://kash.click/assets/img/LogoCaisse.svg" class="inline logoC" alt="Kash POS logo">
            <img src="https://kash.click/assets/img/kash-logo4.svg" class="kash inline mr-8" alt="Kash">
          </a>
        </div>
        <div class="navbar-collapse">
          <a href="https://kash.click" class="bp" style="white-space:nowrap;flex-shrink:0;font-size:.78rem;padding:9px 20px;">Start invoicing →</a>
        </div>
      </div>
    </nav>
  </header>

  <!-- ── HERO ─────────────────────────────────────────── -->
  <main>
  <section class="hero" aria-labelledby="hero-heading">
    <div class="hero-in">
      <div>
        <div class="eyebrow">AI invoicing and POS assistant · MCP compatible</div>
        <h1 id="hero-heading">Your <em>AI invoicing and POS assistant</em></h1>
        <p class="hero-lead">Kash lets you create invoices in seconds, then manage sales, orders, inventory, customers, and reports from ChatGPT, Claude, n8n, or any MCP-compatible AI tool — all in plain language.</p>
        <div class="hero-proof" aria-label="Main benefits">
          <span class="proof"><svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 2h6l3 3v8H3V2z" stroke="#3f78e0" stroke-width="1.3"/><path d="M9 2v3h3M5 8h5M5 10.5h4" stroke="#3f78e0" stroke-width="1.3" stroke-linecap="round"/></svg> Professional invoice in seconds</span>
          <span class="proof"><svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1.8a5.7 5.7 0 1 0 0 11.4 5.7 5.7 0 0 0 0-11.4z" stroke="#16a34a" stroke-width="1.3"/><path d="M5 7.8l1.6 1.6L10.3 5.5" stroke="#16a34a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> Built for services, retail, and hospitality</span>
          <span class="proof"><svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2.5 7.5h10M7.5 2.5v10" stroke="#d97706" stroke-width="1.4" stroke-linecap="round"/></svg> No setup, no code required</span>
        </div>
        <div class="ai-badges">
          <span>Works with</span>
          <span class="ai-badge">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6.5" stroke="#3f78e0" stroke-width="1"/><path d="M4 7h6M7 4v6" stroke="#3f78e0" stroke-width="1.2" stroke-linecap="round"/></svg>
            Claude
          </span>
          <span class="ai-badge">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="3" stroke="#16a34a" stroke-width="1"/><path d="M4 7h6" stroke="#16a34a" stroke-width="1.2" stroke-linecap="round"/></svg>
            ChatGPT
          </span>
          <span class="ai-badge">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M2 7h10M2 10h6" stroke="#d97706" stroke-width="1.2" stroke-linecap="round"/></svg>
            n8n
          </span>
          <span class="ai-badge">+ any MCP client</span>
        </div>
        <div class="ha">
          <a href="https://kash.click" class="bp">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 2h6l3 3v8H3V2z" stroke="currentColor" stroke-width="1.3"/><path d="M9 2v3h3M5 8h5M5 10.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            Start invoicing →
          </a>
          <a href="#howto-heading" class="bs">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 2h7l3 3v8H3V2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M10 2v3h3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 7h6M5 9.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            Connect MCP server
          </a>
        </div>
      </div>

      <!-- Hero demo: invoice first -->
      <div>
        <div class="hdemo" role="img" aria-label="Example conversation with an AI tool creating an invoice in Kash">
          <div class="dtb">
            <div class="dots"><span></span><span></span><span></span></div>
            <span class="dtitle">ChatGPT · Kash MCP</span>
          </div>
          <div class="dbody">
            <div class="cm u"><div class="cav">You</div><div class="cb">Create an invoice for ACME Ltd: website maintenance, 450 dollars excluding tax</div></div>
            <div class="cm ai"><div class="cav">AI</div><div class="cb">I found ACME Ltd in your customers. I’ll create a new invoice with one service line and apply your default tax settings.</div></div>
            <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok"><strong>✓ Invoice created</strong><br>Invoice INV-2026-001 — <strong>$450.00 excl. tax</strong></div><div class="invoice-mini"><div><span>Customer</span><span>ACME Ltd</span></div><div><span>Item</span><span>Website maintenance</span></div><div><span>Total</span><span>$450.00</span></div></div><span class="pill"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 1h5l2 2v7H2V1z" stroke="#3f78e0" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 1v2h2" stroke="#3f78e0" stroke-width="1.2" stroke-linejoin="round"/></svg>Invoice_INV-2026-001.pdf</span></div></div>
            <div class="cm u"><div class="cav">You</div><div class="cb">Now show me unpaid invoices older than 30 days</div></div>
            <div class="cm ai"><div class="cav">AI</div><div class="cb">Found <strong>3 unpaid invoices</strong>. I can draft polite payment reminders for each customer.</div></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── INVOICE FOCUS STRIP ──────────────────────────── -->
  <section class="invstrip" aria-label="Invoice features">
    <div class="invstrip-in">
      <div class="inv-main">
        <strong>Not just a POS: an AI invoice assistant</strong>
        <span>Use Kash for classic shop orders, but also for freelancers, artisans, rentals, B2B services and anyone who needs fast, clean invoicing.</span>
      </div>
      <div class="inv-card"><b>Create invoices</b><p>Turn a simple sentence into a complete customer invoice with products, services, taxes, and totals — automatically.</p></div>
      <div class="inv-card"><b>Find unpaid bills</b><p>Ask for overdue invoices and prepare customer reminders without manual searching.</p></div>
      <div class="inv-card"><b>Reuse business data</b><p>Customers, catalog, payments, and orders stay connected within your Kash account.</p></div>
    </div>
  </section>

  <!-- ── COMPATIBLE TOOLS ──────────────────────────────── -->
  <div class="compat" aria-label="Compatible AI tools">
    <div class="compat-in">
      <span class="compat-label">MCP-compatible with</span>
      <div class="compat-tools">
        <span class="ctool">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#3f78e0" stroke-width="1.2"/><path d="M5 8h6M8 5v6" stroke="#3f78e0" stroke-width="1.3" stroke-linecap="round"/></svg>
          Claude
        </span>
        <span class="ctool">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="3" stroke="#16a34a" stroke-width="1.2"/><path d="M5 8h6" stroke="#16a34a" stroke-width="1.3" stroke-linecap="round"/></svg>
          ChatGPT
        </span>
        <span class="ctool">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="2" stroke="#d97706" stroke-width="1.2"/><circle cx="12" cy="4" r="2" stroke="#d97706" stroke-width="1.2"/><circle cx="12" cy="12" r="2" stroke="#d97706" stroke-width="1.2"/><path d="M6 8h2.5M9.5 4 9 6 10 6" stroke="#d97706" stroke-width="1" stroke-linecap="round"/><path d="M6 8.5 9.5 11" stroke="#d97706" stroke-width="1" stroke-linecap="round"/></svg>
          n8n
        </span>
        <span class="ctool">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1.5" stroke="#7c3aed" stroke-width="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.5" stroke="#7c3aed" stroke-width="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.5" stroke="#7c3aed" stroke-width="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.5" stroke="#7c3aed" stroke-width="1.2"/></svg>
          Automation tools
        </span>
        <span class="ctool">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 5h10M3 8h10M3 11h6" stroke="#60697b" stroke-width="1.3" stroke-linecap="round"/></svg>
          Any MCP client
        </span>
      </div>
      <span class="compat-more">Open standard · No vendor lock-in</span>
    </div>
  </div>

  <!-- ── PERSONAS ──────────────────────────────────────── -->
  <section class="sec bg-g" aria-labelledby="personas-heading">
    <div class="sin">
      <div class="sh fi0">
        <span class="se">Who is it for?</span>
        <h2 id="personas-heading">Built for freelance, artisan and restaurant/shop workflows</h2>
        <p>Kash is useful far beyond a classic cash register. Start with invoice creation, then manage payments, orders, products and customer history from an AI assistant.</p>
      </div>
      <div class="pgrid">
        <div class="pc fi0">
          <div class="pi" style="background:#eef3fd"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="5" width="16" height="12" rx="2" stroke="#3f78e0" stroke-width="1.5"/><path d="M3 9h16" stroke="#3f78e0" stroke-width="1.5"/><path d="M7 13h4" stroke="#3f78e0" stroke-width="1.5" stroke-linecap="round"/></svg></div>
          <h3>Freelance</h3>
          <p>Create invoices for missions, consulting, maintenance or recurring services. Track unpaid invoices and prepare reminders instantly.</p>
        </div>
        <div class="pc fi0">
          <div class="pi" style="background:#f5f3ff"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 17h14M6 17V7l5-3 5 3v10" stroke="#7c3aed" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 17v-5h4v5" stroke="#7c3aed" stroke-width="1.5" stroke-linejoin="round"/></svg></div>
          <h3>Artisan</h3>
          <p>Invoice repairs, custom work, deliveries or appointments. Add products, labor and customer details by simply describing the job.</p>
        </div>
        <div class="pc fi0">
          <div class="pi" style="background:#ecfdf5"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M3 7h16M3 11h16M3 15h10" stroke="#16a34a" stroke-width="1.5" stroke-linecap="round"/></svg></div>
          <h3>Restaurant / shop</h3>
          <p>Record sales, table orders, takeaway, delivery and payments. Keep products, inventory and customer history connected.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ── USE CASES ─────────────────────────────────────── -->
  <section class="sec bg-w" aria-labelledby="usecases-heading">
    <div class="sin">
      <div class="sh fi0">
        <span class="se">In action</span>
        <h2 id="usecases-heading">Start with invoices, then automate the rest</h2>
        <p>These are the everyday requests users actually type into ChatGPT, Claude, n8n or another MCP client.</p>
      </div>
      <div class="ucl">

        <!-- UC 1: Create invoice -->
        <article class="uc fi0">
          <div class="uct">
            <span class="utag">Invoice creation</span>
            <h3>Create a professional invoice from one sentence</h3>
            <p>Ask your AI assistant to instantly create an invoice for a customer, a service, a product order, or a custom job. Kash uses your customer data, catalog and tax settings to prepare the document.</p>
            <ul class="ubl">
              <li>Create invoices for services, products, orders or custom lines</li>
              <li>Use existing customers or create a new one during the conversation</li>
              <li>Apply tax, payment and business settings from your Kash account</li>
              <li>Retrieve the invoice later by customer, date or order number</li>
            </ul>
          </div>
          <div class="ucd">
            <div class="dh"><div class="dhd"></div><span class="dhl">Claude · Kash MCP</span></div>
            <div class="dc">
              <div class="cm u"><div class="cav">M</div><div class="cb">Create an invoice for Pixel Studio — 5 consulting days at $600 per day</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb">I found Pixel Studio. I’ll create one invoice line for 5 consulting days and calculate the total.</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok"><strong>✓ Invoice INV-2026-002 created</strong><br>Total: <strong>$3,000.00</strong></div><span class="pill"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 1h5l2 2v7H2V1z" stroke="#3f78e0" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 1v2h2" stroke="#3f78e0" stroke-width="1.2" stroke-linejoin="round"/></svg>Invoice_INV-2026-002.pdf</span></div></div>
            </div>
          </div>
        </article>

        <!-- UC 2: Missing info / guided invoice -->
        <article class="uc rv fi0">
          <div class="uct">
            <span class="utag amber">Guided setup</span>
            <h3>The assistant asks for missing information</h3>
            <p>If a customer name, address, tax number, or billing detail is missing, the assistant automatically asks a simple follow-up question before creating the invoice. The result is smoother than a form.</p>
            <ul class="ubl">
              <li>No need to know every field in advance</li>
              <li>Missing customer information can be collected during the conversation</li>
              <li>Perfect for first-time customers and one-off invoices</li>
              <li>Reduces errors compared with manual data entry</li>
            </ul>
          </div>
          <div class="ucd">
            <div class="dh"><div class="dhd"></div><span class="dhl">ChatGPT · Kash MCP</span></div>
            <div class="dc">
              <div class="cm u"><div class="cav">S</div><div class="cb">Invoice Martin Lopez for emergency plumbing repair, 180 dollars</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="warn"><strong>Missing customer details</strong><br>I need the customer email or billing address before creating this invoice.</div></div></div>
              <div class="cm u"><div class="cav">S</div><div class="cb">martin@example.com, 14 Green Street, Austin</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok">Customer created. Invoice issued for emergency plumbing repair — $180.00.</div></div></div>
            </div>
          </div>
        </article>

        <!-- UC 3: Customer follow-ups -->
        <article class="uc fi0">
          <div class="uct">
            <span class="utag green">Payment follow-up</span>
            <h3>Find unpaid invoices and prepare reminders</h3>
            <p>Ask your AI tool to instantly list all outstanding invoices past a certain number of days. It identifies the customers, amounts and dates, then helps prepare personalised follow-up messages.</p>
            <ul class="ubl">
              <li>Automatic detection of overdue invoices</li>
              <li>Customer-specific reminder drafts</li>
              <li>Full customer history available before sending</li>
              <li>Useful for freelancers, B2B, services and rentals</li>
            </ul>
          </div>
          <div class="ucd">
            <div class="dh"><div class="dhd"></div><span class="dhl">ChatGPT · Kash MCP</span></div>
            <div class="dc">
              <div class="cm u"><div class="cav">S</div><div class="cb">Which customers haven't paid in over 30 days?</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb">Found <strong>3 overdue invoices</strong>:<br><br>· <strong>Acme Corp</strong> — $1,200 · 48 days<br>· <strong>Fox Studio</strong> — $520 · 37 days<br>· <strong>Jane Smith</strong> — $890 · 31 days<br><br>Shall I draft the follow-up emails?</div></div>
              <div class="cm u"><div class="cav">S</div><div class="cb">Yes — polite for Jane, firmer for the other two</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok">3 reminder drafts prepared for review.</div></div></div>
            </div>
          </div>
        </article>

        <!-- UC 4: Multi-channel stock -->
        <article class="uc rv fi0">
          <div class="uct">
            <span class="utag">Inventory</span>
            <h3>Keep orders and inventory in sync</h3>
            <p>Once invoices and orders are created, Kash automatically keeps stock, customers, and payments consistent across your POS, website, and automation workflows.</p>
            <ul class="ubl">
              <li>Instant stock updates after every sale</li>
              <li>Low-stock alerts configurable per product</li>
              <li>Catalogue updates via any AI tool in one sentence</li>
              <li>Compatible with e-commerce and automation workflows</li>
            </ul>
          </div>
          <div class="ucd">
            <div class="dh"><div class="dhd"></div><span class="dhl">n8n workflow · Kash MCP</span></div>
            <div class="dc">
              <div class="cm u"><div class="cav">n8</div><div class="cb">A sale just went through online: 3× Dark Chocolate 72%</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok"><strong>✓ Stock updated</strong><br>Dark Chocolate 72%: 14 → <strong>11 units</strong><br>Synced across POS, web store and API.</div></div></div>
              <div class="cm u"><div class="cav">n8</div><div class="cb">Stock is below threshold. Create a restock alert.</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok">Alert created. Notification sent to the buyer.</div></div></div>
            </div>
          </div>
        </article>

      </div>
    </div>
  </section>

  <!-- ── PROMPTS ───────────────────────────────────────── -->
  <section class="sec bg-g" aria-labelledby="prompts-heading">
    <div class="sin">
      <div class="sh fi0">
        <span class="se">Copy and paste</span>
        <h2 id="prompts-heading">Useful prompts for Kash MCP</h2>
        <p>Simple requests that deliver immediate value — especially for invoicing.</p>
      </div>
      <div class="promptgrid">
        <div class="promptcard fi0">
          <h3>Invoices</h3>
          <ul>
            <li>“Create an invoice for ACME Ltd for website maintenance, $450 excluding tax.”</li>
            <li>“Create an invoice for 3 hours of consulting at $80 per hour.”</li>
            <li>“Show me the invoice for order 1042.”</li>
            <li>“List unpaid invoices older than 30 days.”</li>
          </ul>
        </div>
        <div class="promptcard fi0">
          <h3>Orders and POS</h3>
          <ul>
            <li>“Create an invoice for table 4 after payment.”</li>
            <li>“Record a sale of 2 coffees at table 4.”</li>
            <li>“Add a card payment to order 1042.”</li>
            <li>“Show pending delivery orders for tonight.”</li>
          </ul>
        </div>
        <div class="promptcard fi0">
          <h3>Reports and catalog</h3>
          <ul>
            <li>“What is my revenue this week?”</li>
            <li>“Who are my best customers this month?”</li>
            <li>“Add a product called Summer Tart at $4.50.”</li>
            <li>“Which products are below their stock alert?”</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ── FEATURES ──────────────────────────────────────── -->
  <section class="sec bg-w" aria-labelledby="features-heading">
    <div class="sin">
      <div class="sh fi0">
        <span class="se">Features</span>
        <h2 id="features-heading">Everything Kash MCP covers</h2>
        <p>A complete MCP server, seamlessly integrated with the key functions of your Kash account.</p>
      </div>
      <div class="fg">
        <div class="fc fi0"><div class="fi" style="background:#fffbeb"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 3h9l4 4v10H3V3z" stroke="#d97706" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 3v4h4M6 10h8M6 13h6" stroke="#d97706" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div><h4>Invoices</h4><p>Create and retrieve invoices, prepare customer billing and follow up unpaid documents from plain language.</p></div>
        <div class="fc fi0"><div class="fi" style="background:#eef3fd"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="12" rx="2" stroke="#3f78e0" stroke-width="1.4"/><path d="M2 8h16" stroke="#3f78e0" stroke-width="1.4"/><path d="M5 12h4" stroke="#3f78e0" stroke-width="1.4" stroke-linecap="round"/></svg></div><h4>Orders & POS</h4><p>Create, edit and validate orders. Dine-in, takeaway, delivery, table service and payments.</p></div>
        <div class="fc fi0"><div class="fi" style="background:#ecfdf5"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4h3l1.5 7h9l1.5-4.5H8" stroke="#16a34a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="15.5" r="1.5" stroke="#16a34a" stroke-width="1.4"/><circle cx="15" cy="15.5" r="1.5" stroke="#16a34a" stroke-width="1.4"/></svg></div><h4>Product catalog</h4><p>Add, edit and remove products. Manage prices, barcodes, categories and stock information.</p></div>
        <div class="fc fi0"><div class="fi" style="background:#f5f3ff"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="#7c3aed" stroke-width="1.4"/><path d="M4 17c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="#7c3aed" stroke-width="1.4" stroke-linecap="round"/></svg></div><h4>Customers</h4><p>Manage customer files, contact details, purchase history, loyalty and balances.</p></div>
        <div class="fc fi0"><div class="fi" style="background:#eef3fd"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="#3f78e0" stroke-width="1.4"/><path d="M7 10h6M10 7v6" stroke="#3f78e0" stroke-width="1.4" stroke-linecap="round"/></svg></div><h4>Inventory</h4><p>Track stock, detect low-stock products and keep sales channels in sync.</p></div>
        <div class="fc fi0"><div class="fi" style="background:#ecfdf5"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v4l3 2" stroke="#16a34a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="10" r="7" stroke="#16a34a" stroke-width="1.4"/></svg></div><h4>Reports</h4><p>Ask for revenue, best customers, unpaid orders, daily reports and business summaries.</p></div>
      </div>
    </div>
  </section>

  <!-- ── HOW IT WORKS ───────────────────────────────────── -->
  <section class="sec bg-g" aria-labelledby="howto-heading">
    <div class="sin">
      <div class="sh fi0">
        <span class="se">Getting started</span>
        <h2 id="howto-heading">Connect Kash MCP in 3 minutes</h2>
        <p>No code, no complex configuration. One OAuth connection and you can start by asking your AI assistant to create an invoice.</p>
      </div>
      <div class="hwrap">
        <div class="steps">
          <div class="step fi0"><div class="sn">1</div><h4>Add the MCP server</h4><p>Paste the server URL into ChatGPT, Claude, n8n or any compatible MCP client and connect your Kash account via OAuth.</p></div>
          <div class="step fi0"><div class="sn">2</div><h4>Set up your account with the assistant</h4><p>Your AI assistant retrieves your business data, customers, products, and settings from your Kash account.</p></div>
          <div class="step fi0"><div class="sn">3</div><h4>Ask for an invoice</h4><p>Type your request in plain language. Kash handles customers, invoice lines, orders, products and reports automatically.</p></div>
        </div>
        <div class="urlbox fi0">
          <label>MCP server URL</label>
          <div class="urlrow">
            <code>https://mcp.kash.click/mcp</code>
            <a href="https://kash.click" class="bp" style="font-size:.78rem;padding:9px 18px;flex-shrink:0;">Start invoicing → →</a>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── FAQ ───────────────────────────────────────────── -->
  <section class="sec bg-w" aria-labelledby="faq-heading">
    <div class="sin">
      <div class="sh fi0">
        <span class="se">FAQ</span>
        <h2 id="faq-heading">Frequently asked questions</h2>
      </div>
      <div class="faqlist">
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">Can I create invoices with ChatGPT or Claude?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">Yes. Connect the Kash MCP server to an MCP-compatible AI tool, then ask it to create an invoice for a customer, a service, an order or a custom line. The assistant can also retrieve invoices and help identify unpaid ones.</div>
        </div>
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">What is the Kash MCP server?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">The Kash MCP server is a Model Context Protocol endpoint that lets compatible AI tools read and write data in your Kash account — invoices, orders, customers, products, inventory and settings.</div>
        </div>
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">Which AI tools are compatible?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">Any tool that supports the Model Context Protocol, including Claude, ChatGPT, n8n and other MCP-compatible clients or automation platforms.</div>
        </div>
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">Is it free?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">Yes. The Kash MCP server is included with all Kash accounts at no extra cost.</div>
        </div>
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">Do I need to know how to code?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">No. You only need to add the MCP server URL to a compatible client and complete OAuth authorization.</div>
        </div>
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">Is my data secure?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">Connections are authenticated through OAuth. Your business data stays in your Kash account and access can be revoked from your settings.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── CTA ───────────────────────────────────────────── -->
  <section class="sec bg-d" aria-labelledby="cta-heading">
    <div class="ctain">
      <h2 id="cta-heading">Try your AI invoicing and POS assistant</h2>
      <p>Create your free Kash account, connect the MCP server to your preferred AI tool, and start managing invoices, customers, orders, and reports instantly in plain language.</p>
      <div class="ctabtns">
        <a href="https://kash.click" class="bw">Start invoicing →</a>
        <a href="#howto-heading" class="bgo">Connect MCP server →</a>
      </div>
    </div>
  </section>
  </main>

  <!-- ── FOOTER (original Kash structure, no nav links) ── -->
  <footer class="ft">
    <div class="ftin">
      <div class="ftlogo">
        <img src="https://kash.click/assets/img/LogoCaisse.svg" class="inline logoC" alt="Kash">
        <img src="https://kash.click/assets/img/kash-logo4.svg" class="kash inline" alt="Kash online cash register">
      </div>
      <span class="ftcopy">© 2026 kash.click — AI invoicing · Free POS Software · MCP Server · Open Standard</span>
    </div>
  </footer>

</div><!-- /#NEWUI -->

<script>
/* Scroll animations */
const obs = new IntersectionObserver((e) => {
  e.forEach(x => { if(x.isIntersecting){ x.target.classList.add('vis'); obs.unobserve(x.target); } });
}, { threshold: 0.1, rootMargin: '0px 0px -28px 0px' });
document.querySelectorAll('.fi0').forEach((el, i) => {
  el.style.transitionDelay = (i % 4) * 0.07 + 's';
  obs.observe(el);
});

/* Sticky nav */
const clone = document.querySelector('.navbar-clone');
window.addEventListener('scroll', () => {
  if(window.scrollY > 80){
    clone.style.transform = 'translateY(0)';
    clone.style.background = 'rgba(255,255,255,0.96)';
    clone.style.boxShadow = '0 1px 0 rgba(8,60,130,0.08)';
    clone.style.backdropFilter = 'blur(12px)';
  } else {
    clone.style.transform = 'translateY(-100%)';
  }
}, {passive:true});

/* FAQ accordion */
document.querySelectorAll('.faqq').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faqitem');
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faqitem.open').forEach(el => {
      el.classList.remove('open');
      el.querySelector('.faqq').setAttribute('aria-expanded','false');
    });
    if(!isOpen){
      item.classList.add('open');
      btn.setAttribute('aria-expanded','true');
    }
  });
});
</script>
</body>
</html>


`;

// Initialise le store (Redis si disponible, sinon mémoire)
await initStore();

const app = express();

app.use(await oauthRouter());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, Mcp-Session-Id, x-api-key, x-apikey, x-shop-id, x-shopid');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});
app.use(express.json());

function getSessionId(req: express.Request): string | undefined {
    return req.get('Mcp-Session-Id') || req.get('mcp-session-id') || undefined;
}

// Isole chaque requête /mcp dans son propre contexte de session
app.use('/mcp', (req, res, next) => {
    const sessionId = getSessionId(req) ?? randomUUID();
    runWithSession(sessionId, () => next());
});

// Middleware d'authentification
app.post('/mcp', async (req, res, next) => {
    try {
        if (req.body?.method === 'initialize') return next();

        const auth = req.get('authorization') ?? req.get('Authorization');
        if (auth?.startsWith('Bearer ')) {
            const { apiKey, shopId } = await bearerValidator(auth);
            setSessionAuth({ ok: true, SHOPID: shopId, APIKEY: apiKey, scopes: ['mcp:invoke'] });
            return next();
        }

        const apiKey = req.get('x-api-key') ?? req.get('x-apikey') ?? '';
        const shopId = req.get('x-shop-id') ?? req.get('x-shopid') ?? '';
        if (apiKey && shopId) {
            setSessionAuth({ ok: true, SHOPID: shopId, APIKEY: apiKey, scopes: ['*'] });
            return next();
        }

        return next();
    } catch {
        return next();
    }
});

const mcpServer = new McpServer({
    name: 'caisse-enregistreuse-api',
    version: '1.4.1',
});

registerAuthTools(mcpServer);
registerSalesTools(mcpServer);
registerDataTools(mcpServer);
registerVatTools(mcpServer);
registerCatalogTools(mcpServer);
registerClientTools(mcpServer);
registerPaymentModeTools(mcpServer);
registerPrompts(mcpServer);
registerResources(mcpServer);

const transports = new Map<string, StreamableHTTPServerTransport>();

const asyncHandler =
    (fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>) =>
        (req: express.Request, res: express.Response, next: express.NextFunction) =>
            Promise.resolve(fn(req, res, next)).catch(next);

app.post(
    '/mcp',
    asyncHandler(async (req: express.Request, res: express.Response) => {
        const sessionId = getSessionId(req);

        if (sessionId) {
            let transport = transports.get(sessionId);

            if (!transport) {
                const method = (req.body as any)?.method;
                if (method !== 'initialize') {
                    return res.status(400).json({
                        jsonrpc: '2.0',
                        error: { code: -32000, message: 'Bad Request: Session expirée, veuillez réinitialiser' },
                        id: null,
                    });
                }

                // Reprise de session après redémarrage
                process.stderr.write('[mcp] Reprise de session ' + sessionId + '\n');
                const storedAuth = await loadSessionAuth(sessionId);

                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => sessionId,
                    onsessioninitialized: (sid: string) => {
                        transports.set(sid, transport!);
                        if (storedAuth) {
                            setSessionAuth(storedAuth);
                            process.stderr.write('[mcp] Auth restaurée pour ' + sid + '\n');
                        }
                    },
                });

                transport.onclose = () => { transports.delete(sessionId); };
                await mcpServer.connect(transport);
            }

            await transport.handleRequest(req, res, req.body);
            return;
        }

        // Nouvelle session
        const method = (req.body as any)?.method;
        if (method !== 'initialize') {
            return res.status(400).json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Bad Request: Server not initialized' },
                id: null,
            });
        }

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId: string) => {
                transports.set(newSessionId, transport!);
                updateSessionId(newSessionId);
            },
        });

        transport.onclose = () => {
            const id = transport?.sessionId;
            if (id) transports.delete(id);
        };

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
    })
);

const handleSessionRequest = asyncHandler(async (req: express.Request, res: express.Response) => {
    const sessionId = getSessionId(req);
    if (!sessionId) { res.status(400).send('Invalid or missing session ID'); return; }
    const transport = transports.get(sessionId);
    if (!transport) { res.status(404).send('Unknown session'); return; }
    await transport.handleRequest(req, res);
});

app.get('/mcp', (req, res, next) => {
    const sessionId = getSessionId(req);
    if (!sessionId && req.accepts('html')) {
        return res.type('html').send(LANDING_HTML);
    }
    return handleSessionRequest(req, res, next);
});
//app.get('/mcp', handleSessionRequest);

app.delete('/mcp', handleSessionRequest);

app.get("/", (req, res) => {
    res.type('html').send(LANDING_HTML);
});
/*app.get("/", (req, res) => {
    res.redirect("https://kash.click/free-pos-software/ChatGPT");
});*/

const port = Number(process.env.PORT || 8787);
app
    .listen(port, () => console.log(`MCP server running at http://localhost:${port}/mcp`))
    .on('error', (error) => { console.error('Server error:', error); process.exit(1); });