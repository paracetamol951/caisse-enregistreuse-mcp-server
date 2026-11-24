# Quote a Kash cart

`calculate_cart` returns a read-only preview for the connected shop with item prices, variant supplements, line amounts, tax breakdown and cart totals. Checkout remains a separate operation and recalculates the amount using the rules in effect at checkout.

| Transport | Required credentials |
| --- | --- |
| HTTP OAuth | A Kash connection bound to a shop that grants `catalog.read`. |
| STDIO | Set `SHOPID` and `KASH_PARTNER_API_KEY` in the MCP server environment. The latter is a managed partner key for that shop with `catalog.read`. Keep any legacy API key in the existing `APIKEY` variable for legacy tools. The quote tool is exposed only when a managed key is configured. |

Both transports use `POST /api/partner/v1/cart-quotes`. Replace the sample PLU and optional variant choice IDs with those from your connected catalog.

```json
{
  "name": "calculate_cart",
  "arguments": {
    "lines": [
      { "item_id": 17, "quantity": 2, "variant_ids": [42] },
      { "item_id": 23, "quantity": 1 }
    ],
    "context": "on_premises"
  }
}
```

For example, ask "Show the total price and VAT for this cart before I check out." Read `structuredContent.totals.gross` for the total and `structuredContent.taxes` for the VAT by rate. Monetary values are decimal strings in the response currency.

The tool accepts ordinary catalog PLUs and their variant choices, with quantities of up to three decimal places in the PLU's sale unit, fixed or percentage catalog discounts, and the applicable VAT rate. Combine quantities for identical PLUs and choices on one line. Choose `on_premises` (the default) or `takeaway`. Delivery requires an eligible shop configuration.

Kash rejects free lines, forced prices, customer-specific pricing, cart discounts, packs and menus, active quantity entry factors, VAT on margins, and active automatic promotions or surcharges. Scales and price-encoded barcodes are outside the input contract. The preview contains pricing and VAT. Stock availability is outside its coverage.

Run the local transport tests with `node --import tsx --test tests/cart-quotes.test.mjs`.
