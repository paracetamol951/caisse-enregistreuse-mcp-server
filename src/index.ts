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
<title>Kash MCP Server — Connect Your Shop to Any AI Tool</title>
<meta name="description" content="Kash MCP Server lets you manage orders, invoices, inventory and customers from Claude, ChatGPT, n8n, or any MCP-compatible tool — in plain language. Free for all Kash accounts.">
<meta name="keywords" content="MCP server, Kash POS, AI business management, invoicing AI, inventory management, ChatGPT shop integration, Claude MCP, n8n automation, online cash register, free POS software">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://mcp.kash.click">
<link rel="alternate" hreflang="en" href="https://mcp.kash.click">
<link rel="alternate" hreflang="fr" href="https://mcp.caisse.enregistreuse.fr">
<link rel="alternate" hreflang="x-default" href="https://mcp.kash.click">

<!-- Open Graph -->
<meta property="og:title" content="Kash MCP Server — Connect Your Shop to Any AI Tool">
<meta property="og:description" content="Manage orders, invoices, inventory and customers from Claude, ChatGPT, n8n or any MCP-compatible tool — in plain language.">
<meta property="og:url" content="https://mcp.kash.click">
<meta property="og:site_name" content="kash.click">
<meta property="og:image" content="https://kash.click/PreviewEN.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_US">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Kash MCP Server — Connect Your Shop to Any AI Tool">
<meta name="twitter:description" content="Manage orders, invoices, inventory and customers from Claude, ChatGPT, n8n or any MCP-compatible tool — in plain language.">
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
      "name": "Kash MCP Server",
      "description": "MCP server for Kash POS — connect your shop to Claude, ChatGPT, n8n or any MCP-compatible AI tool to manage orders, invoices, inventory and customers in plain language.",
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
      "name": "Kash MCP Server — Connect Your Shop to Any AI Tool",
      "description": "Manage orders, invoices, inventory and customers from Claude, ChatGPT, n8n or any MCP-compatible tool — in plain language.",
      "inLanguage": "en",
      "isPartOf": { "@id": "https://kash.click/#website" }
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is the Kash MCP server?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "The Kash MCP server is a Model Context Protocol endpoint that lets any compatible AI tool (Claude, ChatGPT, n8n, etc.) read and write data in your Kash account — orders, invoices, customers, products and settings."
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
            "text": "Any tool that supports the Model Context Protocol: Claude (Anthropic), ChatGPT with MCP plugins, n8n, and any other MCP-compatible client or automation platform."
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
.navbar-collapse{flex-grow:1;flex-basis:100%;align-items:center;display:flex;}
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
.hero-lead{font-size:.96rem;line-height:1.65;color:var(--mut);margin-bottom:24px;max-width:460px;}

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

/* ── SECTIONS ─────────────────────────────────────────── */
.sec{padding:84px 24px;}
.sec.bg-g{background:var(--bg);}
.sec.bg-w{background:var(--wh);}
.sec.bg-d{background:var(--ink);}
.sin{max-width:1140px;margin:0 auto;}
.sh{text-align:center;margin-bottom:52px;}
.se{display:inline-block;color:var(--blue);font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:9px;}
.sh h2{font-size:1.85rem;font-weight:700;color:var(--ink);letter-spacing:-.025em;line-height:1.25;margin-bottom:10px;}
.sh p{font-size:.92rem;color:var(--mut);max-width:490px;margin:0 auto;}

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
.faqitem.open .faqa{max-height:200px;padding:0 22px 18px;}

/* ── CTA ──────────────────────────────────────────────── */
.ctain{max-width:620px;margin:0 auto;text-align:center;}
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
  .uc{grid-template-columns:1fr;gap:26px;}
  .uc.rv{direction:ltr;}
  .fg{grid-template-columns:repeat(2,1fr);}
  .steps{grid-template-columns:1fr;gap:32px;}
  .steps::before{display:none;}
  .ftin{flex-direction:column;text-align:center;}
}
@media(max-width:600px){
  .sec{padding:52px 16px;}
  .pgrid,.fg{grid-template-columns:1fr;}
  .ctain h2{font-size:1.55rem;}
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
      <a href="https://kash.click" class="bp" style="white-space:nowrap;flex-shrink:0;font-size:.78rem;padding:9px 20px;">Get started free</a>
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
          <a href="https://kash.click" class="bp" style="white-space:nowrap;flex-shrink:0;font-size:.78rem;padding:9px 20px;">Get started free</a>
        </div>
      </div>
    </nav>
  </header>

  <!-- ── HERO ─────────────────────────────────────────── -->
  <main>
  <section class="hero" aria-labelledby="hero-heading">
    <div class="hero-in">
      <div>
        <div class="eyebrow">Model Context Protocol · Open Standard</div>
        <h1 id="hero-heading">Your shop, controlled<br>by <em>any AI tool</em></h1>
        <p class="hero-lead">Kash MCP Server connects your POS to the AI tools you already use. Create invoices, manage stock, follow up with customers — in plain language, from any compatible platform.</p>
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
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1a6.5 6.5 0 1 1 0 13A6.5 6.5 0 0 1 7.5 1zm0 5.5h-1v4h3V8.5H8.5V6.5zm0-3a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="currentColor"/></svg>
            Start for free
          </a>
          <a href="https://kash.click/cash-register-software/" class="bs">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 2h7l3 3v8H3V2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M10 2v3h3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 7h6M5 9.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            Read the docs
          </a>
        </div>
      </div>
      <!-- Hero demo: stock check + update via n8n workflow -->
      <div>
        <div class="hdemo" role="img" aria-label="Example conversation with an AI tool managing Kash inventory">
          <div class="dtb">
            <div class="dots"><span></span><span></span><span></span></div>
            <span class="dtitle">n8n workflow · Kash MCP</span>
          </div>
          <div class="dbody">
            <div class="cm u"><div class="cav">n8</div><div class="cb">List all products with stock below their alert threshold</div></div>
            <div class="cm ai"><div class="cav">AI</div><div class="cb">Found <strong>3 low-stock products</strong>:<br><br>· Espresso Blend 500g — <strong>4 left</strong> (threshold: 10)<br>· Reusable Cup 35cl — <strong>2 left</strong> (threshold: 5)<br>· Filter Paper ×100 — <strong>0 left</strong> (threshold: 8)</div></div>
            <div class="cm u"><div class="cav">n8</div><div class="cb">Create a draft purchase order for these 3 items and notify the supplier by email</div></div>
            <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok"><strong>✓ Purchase order PO-2025-047 created</strong><br>Supplier notified at orders@supplier.com<br>Expected restock: within 48 h</div></div></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── COMPATIBLE TOOLS ──────────────────────────────── -->
  <div class="compat" aria-label="Compatible AI tools">
    <div class="compat-in">
      <span class="compat-label">MCP-compatible with</span>
      <div class="compat-tools">
        <span class="ctool">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#3f78e0" stroke-width="1.2"/><path d="M5 8h6M8 5v6" stroke="#3f78e0" stroke-width="1.3" stroke-linecap="round"/></svg>
          Claude (Anthropic)
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
          Make / Zapier
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
        <h2 id="personas-heading">One MCP server, dozens of business types</h2>
        <p>Whether you sell products, services, or experiences — Kash MCP adapts to your workflow and the AI tools you prefer.</p>
      </div>
      <div class="pgrid">
        <div class="pc fi0">
          <div class="pi" style="background:#eef3fd"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="5" width="16" height="12" rx="2" stroke="#3f78e0" stroke-width="1.5"/><path d="M3 9h16" stroke="#3f78e0" stroke-width="1.5"/><path d="M7 13h4" stroke="#3f78e0" stroke-width="1.5" stroke-linecap="round"/></svg></div>
          <h3>Freelancers & consultants</h3>
          <p>Generate invoices in one sentence, track unpaid bills and automate reminders from your AI assistant.</p>
        </div>
        <div class="pc fi0">
          <div class="pi" style="background:#ecfdf5"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 4h3l1.5 7h9l1.5-4.5H8" stroke="#16a34a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.5" cy="16.5" r="1.5" stroke="#16a34a" stroke-width="1.5"/><circle cx="16" cy="16.5" r="1.5" stroke="#16a34a" stroke-width="1.5"/></svg></div>
          <h3>Retailers & shops</h3>
          <p>Inventory synced across every channel in real time — POS terminal, website, or any AI workflow.</p>
        </div>
        <div class="pc fi0">
          <div class="pi" style="background:#fffbeb"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="3" width="16" height="16" rx="2" stroke="#d97706" stroke-width="1.5"/><path d="M7 8h8M7 12h5" stroke="#d97706" stroke-width="1.5" stroke-linecap="round"/><path d="M7 16h8" stroke="#d97706" stroke-width="1.5" stroke-linecap="round"/></svg></div>
          <h3>E-commerce sites</h3>
          <p>Record orders from any website via the MCP API. Inventory, invoices and customers stay in sync automatically.</p>
        </div>
        <div class="pc fi0">
          <div class="pi" style="background:#f5f3ff"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 3C7.686 3 5 5.686 5 9c0 4 6 10 6 10s6-6 6-10c0-3.314-2.686-6-6-6z" stroke="#7c3aed" stroke-width="1.5"/><circle cx="11" cy="9" r="2" stroke="#7c3aed" stroke-width="1.5"/></svg></div>
          <h3>Airbnb & short-term rentals</h3>
          <p>PDF invoice in 10 seconds per stay. Manage recurring guests and their full booking history.</p>
        </div>
        <div class="pc fi0">
          <div class="pi" style="background:#eef3fd"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M3 7h16M3 11h16M3 15h10" stroke="#3f78e0" stroke-width="1.5" stroke-linecap="round"/></svg></div>
          <h3>Restaurants & cafés</h3>
          <p>Table orders, takeaway, delivery and drive-through — managed from any AI tool or your POS terminal.</p>
        </div>
        <div class="pc fi0">
          <div class="pi" style="background:#ecfdf5"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="6" width="16" height="12" rx="2" stroke="#16a34a" stroke-width="1.5"/><path d="M8 6V5a3 3 0 0 1 6 0v1" stroke="#16a34a" stroke-width="1.5" stroke-linecap="round"/><circle cx="11" cy="12" r="1" fill="#16a34a"/></svg></div>
          <h3>Accountants & bookkeepers</h3>
          <p>Automated accounting exports, VAT breakdown and platform sync — zero manual re-entry.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ── USE CASES ─────────────────────────────────────── -->
  <section class="sec bg-w" aria-labelledby="usecases-heading">
    <div class="sin">
      <div class="sh fi0">
        <span class="se">In action</span>
        <h2 id="usecases-heading">Real-world use cases</h2>
        <p>See what you can do with Kash MCP — in plain language, across any compatible AI tool.</p>
      </div>
      <div class="ucl">

        <!-- UC 1: First invoice guided -->
        <article class="uc fi0">
          <div class="uct">
            <span class="utag">Invoicing</span>
            <h3>Your first invoice — guided step by step</h3>
            <p>Before issuing any invoice, the MCP checks that your profile is complete: company ID, address, tax number. It asks for whatever is missing, then generates a legally compliant PDF right away.</p>
            <ul class="ubl">
              <li>Automatic check of all legally required fields</li>
              <li>Sequential invoice numbering handled automatically</li>
              <li>Downloadable PDF + online payment link included</li>
              <li>Immediately archived in your Kash account</li>
            </ul>
          </div>
          <div class="ucd">
            <div class="dh"><div class="dhd"></div><span class="dhl">Claude · Kash MCP</span></div>
            <div class="dc">
              <div class="cm u"><div class="cav">M</div><div class="cb">Invoice for Pixel Studio — 5 dev days at $600/day</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb">Checking your profile before issuing…<div class="warn"><strong>⚠ Missing information</strong><br>Your EIN and business address are not set. Both are required on invoices.</div></div></div>
              <div class="cm u"><div class="cav">M</div><div class="cb">EIN 98-7654321 — 8 Market St, San Francisco, CA 94105</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok"><strong>✓ Profile updated</strong><br>Invoice INV-2025-001 issued — <strong>$3,000.00</strong></div><span class="pill"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 1h5l2 2v7H2V1z" stroke="#3f78e0" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 1v2h2" stroke="#3f78e0" stroke-width="1.2" stroke-linejoin="round"/></svg>Invoice_INV-2025-001.pdf</span></div></div>
            </div>
          </div>
        </article>

        <!-- UC 2: Customer follow-ups -->
        <article class="uc rv fi0">
          <div class="uct">
            <span class="utag">Customer management</span>
            <h3>Automated follow-ups for unpaid invoices</h3>
            <p>Ask your AI tool to list all outstanding invoices past a certain number of days. It identifies the customers, drafts personalised reminder emails — and sends them with your approval.</p>
            <ul class="ubl">
              <li>Automatic detection of all overdue invoices</li>
              <li>Personalised reminders tailored per customer</li>
              <li>Full history of all customer interactions</li>
              <li>Loyalty points, credits and balances at a glance</li>
            </ul>
          </div>
          <div class="ucd">
            <div class="dh"><div class="dhd"></div><span class="dhl">ChatGPT · Kash MCP</span></div>
            <div class="dc">
              <div class="cm u"><div class="cav">S</div><div class="cb">Which customers haven't paid in over 30 days?</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb">Found <strong>3 overdue invoices</strong>:<br><br>· <strong>Acme Corp</strong> — $1,200 · 48 days<br>· <strong>Fox Studio</strong> — $520 · 37 days<br>· <strong>Jane Smith</strong> — $890 · 31 days<br><br>Shall I draft the follow-up emails?</div></div>
              <div class="cm u"><div class="cav">S</div><div class="cb">Yes — polite for Jane, firmer for the other two</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok">3 emails drafted per your instructions. Review before sending?</div></div></div>
            </div>
          </div>
        </article>

        <!-- UC 3: Multi-channel stock -->
        <article class="uc fi0">
          <div class="uct">
            <span class="utag">Inventory</span>
            <h3>One inventory, all channels in sync</h3>
            <p>Whether a sale goes through your physical POS, your e-commerce site, a third-party vendor or an AI workflow — your Kash stock updates in real time. No more surprise stockouts.</p>
            <ul class="ubl">
              <li>Instant sync after every sale on any channel</li>
              <li>Low-stock alerts configurable per product</li>
              <li>Catalogue updates via any AI tool in one sentence</li>
              <li>Compatible with Prestashop and other platforms</li>
            </ul>
          </div>
          <div class="ucd">
            <div class="dh"><div class="dhd"></div><span class="dhl">n8n workflow · Kash MCP</span></div>
            <div class="dc">
              <div class="cm u"><div class="cav">n8</div><div class="cb">A sale just went through on Prestashop: 3× Dark Chocolate 72%</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok"><strong>✓ Stock updated</strong><br>Dark Chocolate 72%: 14 → <strong>11 units</strong><br>Synced across POS, web store and API.</div></div></div>
              <div class="cm u"><div class="cav">n8</div><div class="cb">Stock is now below threshold. Create a restock alert and notify the buyer</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok">Alert created. Notification sent to buyer@myshop.com.</div></div></div>
            </div>
          </div>
        </article>

        <!-- UC 4: Configuration -->
        <article class="uc rv fi0">
          <div class="uct">
            <span class="utag">Setup & configuration</span>
            <h3>Configure your entire account by asking</h3>
            <p>Enable delivery modes, set receipt preferences, connect your Prestashop store or activate payment terminals — without digging through any settings menu.</p>
            <ul class="ubl">
              <li>Business profile setup in plain language</li>
              <li>Delivery modes: table, takeaway, drive-through, relay</li>
              <li>Receipt header, footer and display preferences</li>
              <li>Integrations: PayPal, Yavin, Viva.com, Prestashop</li>
            </ul>
          </div>
          <div class="ucd">
            <div class="dh"><div class="dhd"></div><span class="dhl">Claude · Kash MCP</span></div>
            <div class="dc">
              <div class="cm u"><div class="cav">R</div><div class="cb">Enable takeaway and delivery, and add "Thanks for your order!" to receipts</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok"><strong>✓ Settings updated</strong><br>· Takeaway: enabled<br>· Home delivery: enabled<br>· Receipt footer: "Thanks for your order!"</div></div></div>
              <div class="cm u"><div class="cav">R</div><div class="cb">Connect my Prestashop at myshop.com with API key abc123</div></div>
              <div class="cm ai"><div class="cav">AI</div><div class="cb"><div class="ok"><strong>✓ Prestashop connected</strong><br>Orders and stock now sync between myshop.com and Kash.</div></div></div>
            </div>
          </div>
        </article>

      </div>
    </div>
  </section>

  <!-- ── FEATURES ──────────────────────────────────────── -->
  <section class="sec bg-g" aria-labelledby="features-heading">
    <div class="sin">
      <div class="sh fi0">
        <span class="se">Features</span>
        <h2 id="features-heading">Everything Kash MCP covers</h2>
        <p>A complete MCP server, wired into every function of your Kash account.</p>
      </div>
      <div class="fg">
        <div class="fc fi0"><div class="fi" style="background:#eef3fd"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="12" rx="2" stroke="#3f78e0" stroke-width="1.4"/><path d="M2 8h16" stroke="#3f78e0" stroke-width="1.4"/><path d="M5 12h4" stroke="#3f78e0" stroke-width="1.4" stroke-linecap="round"/></svg></div><h4>Orders & POS</h4><p>Create, edit and validate orders. Dine-in, takeaway, delivery, table service, drive-through — all modes.</p></div>
        <div class="fc fi0"><div class="fi" style="background:#ecfdf5"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4h3l1.5 7h9l1.5-4.5H8" stroke="#16a34a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="15.5" r="1.5" stroke="#16a34a" stroke-width="1.4"/><circle cx="15" cy="15.5" r="1.5" stroke="#16a34a" stroke-width="1.4"/></svg></div><h4>Product catalogue</h4><p>Add, edit and remove products. Manage variations, barcodes, buying price and selling price.</p></div>
        <div class="fc fi0"><div class="fi" style="background:#fffbeb"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h8" stroke="#d97706" stroke-width="1.4" stroke-linecap="round"/></svg></div><h4>Legal invoicing</h4><p>Compliant PDFs, sequential numbering, VAT breakdown, required fields verified before every issue.</p></div>
        <div class="fc fi0"><div class="fi" style="background:#f5f3ff"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="#7c3aed" stroke-width="1.4"/><path d="M4 17c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="#7c3aed" stroke-width="1.4" stroke-linecap="round"/></svg></div><h4>Customer management</h4><p>Full customer file, loyalty points, credit balances, purchase history and personalised follow-ups.</p></div>
        <div class="fc fi0"><div class="fi" style="background:#eef3fd"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="#3f78e0" stroke-width="1.4"/><path d="M7 10h6M10 7v6" stroke="#3f78e0" stroke-width="1.4" stroke-linecap="round"/></svg></div><h4>Real-time inventory</h4><p>Low-stock alerts, updates from any channel, configurable thresholds per product.</p></div>
        <div class="fc fi0"><div class="fi" style="background:#ecfdf5"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v4l3 2" stroke="#16a34a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="10" r="7" stroke="#16a34a" stroke-width="1.4"/></svg></div><h4>Reports & accounting</h4><p>Sales reports, accounting exports, integrations with PayPal, Yavin, Viva.com and Prestashop.</p></div>
      </div>
    </div>
  </section>

  <!-- ── HOW IT WORKS ───────────────────────────────────── -->
  <section class="sec bg-w" aria-labelledby="howto-heading">
    <div class="sin">
      <div class="sh fi0">
        <span class="se">Getting started</span>
        <h2 id="howto-heading">Up and running in 3 minutes</h2>
        <p>No code, no complex configuration. One OAuth connection and you're ready from any MCP client.</p>
      </div>
      <div class="hwrap">
        <div class="steps">
          <div class="step fi0"><div class="sn">1</div><h4>Create your Kash account</h4><p>Free, no credit card required. Your shop is ready in 2 minutes on kash.click.</p></div>
          <div class="step fi0"><div class="sn">2</div><h4>Add the MCP server</h4><p>Paste the server URL into your MCP client — Claude, ChatGPT, n8n, or any compatible tool. Authorise via OAuth.</p></div>
          <div class="step fi0"><div class="sn">3</div><h4>Talk to your shop</h4><p>Create an invoice, check stock, follow up with a customer — your AI tool handles it through Kash.</p></div>
        </div>
        <div class="urlbox fi0">
          <label>MCP server URL</label>
          <div class="urlrow">
            <code>https://mcp.kash.click/mcp</code>
            <a href="https://kash.click" class="bp" style="font-size:.78rem;padding:9px 18px;flex-shrink:0;">Get started →</a>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── FAQ ───────────────────────────────────────────── -->
  <section class="sec bg-g" aria-labelledby="faq-heading">
    <div class="sin">
      <div class="sh fi0">
        <span class="se">FAQ</span>
        <h2 id="faq-heading">Frequently asked questions</h2>
      </div>
      <div class="faqlist">
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">What is the Kash MCP server?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">The Kash MCP server is a Model Context Protocol endpoint that lets any compatible AI tool read and write data in your Kash account — orders, invoices, customers, products and settings. It uses the open MCP standard, meaning it works with Claude, ChatGPT, n8n, and any other MCP-compatible client.</div>
        </div>
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">Which AI tools are compatible?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">Any tool that supports the Model Context Protocol: Claude (Anthropic), ChatGPT with MCP plugins, n8n, Make, Zapier (with MCP bridge), and any other MCP-compatible client or automation platform. The list keeps growing as MCP adoption expands.</div>
        </div>
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">Is it free?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">Yes. The Kash MCP server is included with all Kash accounts at no extra cost. Kash itself is also free to use as a POS system.</div>
        </div>
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">Do I need to know how to code?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">No. Connecting the MCP server requires pasting a URL and completing a simple OAuth authorisation. No coding, no API keys, no configuration files.</div>
        </div>
        <div class="faqitem fi0">
          <button class="faqq" aria-expanded="false">Is my data secure?<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
          <div class="faqa">All MCP connections are authenticated via OAuth 2.0. Your data stays in your Kash account and is never shared with third parties. You can revoke access to any MCP client at any time from your Kash settings.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── CTA ───────────────────────────────────────────── -->
  <section class="sec bg-d" aria-labelledby="cta-heading">
    <div class="ctain">
      <h2 id="cta-heading">Ready to connect your shop to AI?</h2>
      <p>Create your free Kash account, add the MCP server to your preferred AI tool, and start managing your business in plain language.</p>
      <div class="ctabtns">
        <a href="https://kash.click" class="bw">Create a free account</a>
        <a href="https://kash.click/cash-register-software/" class="bgo">MCP documentation →</a>
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
      <span class="ftcopy">© 2025 kash.click — Free POS Software · MCP Server · Open Standard</span>
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