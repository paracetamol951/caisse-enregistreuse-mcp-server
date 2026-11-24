# Kash sales summaries and invoice documents

Both tools return the partner API's structured JSON for the selected Kash shop. Each call is read-only.

| Tool | Required read permission | Partner API |
| --- | --- | --- |
| `sales_summary` | `reports.read` | `GET /api/partner/v1/reports/sales-summary` |
| `list_invoice_documents` | `invoices.read` | `GET /api/partner/v1/invoices/{id}/documents` |

HTTP uses the shop selected during Kash OAuth consent. Grant `accounting_transmissions.read` as well to see transmission history. With STDIO, set `KASH_PARTNER_API_KEY` to a managed partner key with the relevant permissions and set `SHOPID` or `MCP_SHOPID` for the selected shop. Launch `node build/stdio.js` from a built checkout when using only a managed key. The packaged CLI startup also requires the historical `SHOPID` and `APIKEY` settings. The existing `report_get` tool continues to use its historical authentication and formats.

## Sales summary

Pass `from` and `to` as inclusive business dates in `YYYY-MM-DD` format. The range can span up to 360 business days. The optional `cash_register_id` is a signed integer or its decimal string. The shop opening time determines each day's boundary. The response gives the fixed UTC offset and the actual half-open interval in `period.start_at` and `period.end_at_exclusive`. For example, an opening time of 05:00 includes a 01:30 sale on the following calendar date in the preceding business day.

Kash includes validated orders in the selected period, including unpaid orders and qualifying archives. The report applies the stored, tax-inclusive order total less recorded tips, with negative orders counted as refunds. A cancellation of an already validated order is reflected by a recorded reversing order. The report follows Kash's turnover selection, which can include cash movements, deposits and gift-card orders.

The currency code `XXX` indicates that Kash could not determine the configured currency. Kash rounds each aggregate after summing, using the shop's configured price rounding. Amounts are decimal strings with at least two decimal places and more when needed for that rounding. Totals by business day and cash register show gross sales, signed refunds, net sales and separate sale and refund counts. Independent rounding of each group can produce small differences when adding the groups back together. The payment-method breakdown shows counts and signed applied amounts for attached, nonzero payments after change, with recorded tips excluded. A split sale contributes once to sales and each payment to its method. Payment totals can differ from sales totals, for example when an order is unpaid.

Example call with fictitious data.

```json
{"name":"sales_summary","arguments":{"from":"2026-10-18","to":"2026-10-18","cash_register_id":2}}
```

Relevant fields from the result.

```json
{
  "currency": "EUR",
  "timezone": "+02:00",
  "period": {
    "from": "2026-10-18",
    "to": "2026-10-18",
    "start_at": "2026-10-18T05:00:00+02:00",
    "end_at_exclusive": "2026-10-19T05:00:00+02:00"
  },
  "business_day": {"opening_time":"05:00:00","date_field":"datevaleur"},
  "totals": {"gross_sales_amount":"60.00","refund_amount":"-12.00","net_sales_amount":"48.00","sale_count":1,"refund_count":1},
  "by_payment_method": [
    {"payment_method_id":3,"payment_type_id":1,"payment_count":1,"applied_amount":"25.00"},
    {"payment_method_id":4,"payment_type_id":2,"payment_count":2,"applied_amount":"23.00"}
  ]
}
```

## Invoice documents

Pass `invoice_id` as the positive Kash invoice ID or its decimal string. The result includes identifiers, references and issuance dates for the invoice and its explicitly linked credit notes. Each document entry identifies its format and availability. `factur_x` identifies a PDF with its embedded invoice XML. An available document includes a relative partner API download path. Follow it using a separately authorized partner connection for the same shop. The MCP call only reads metadata. An unavailable document has a null `download_path`.

With accounting permission, `transmission.pennylane` reports the recorded status and available dated references from the Pennylane transmission registry. `sent`, `pending`, `failed`, `uncertain` and `excluded` reflect registry evidence. `unknown` means the source provides no conclusive record. `unavailable` indicates an unavailable integration or registry. A null `transmission` indicates that the connection lacks accounting read access. File availability and accounting transmission are separate.

Example call with fictitious data.

```json
{"name":"list_invoice_documents","arguments":{"invoice_id":517}}
```

```json
{
  "invoice": {"id":517,"reference":"FAC-517","issued_at":"2026-10-18T12:37:00+02:00"},
  "documents": [
    {"id":"pdf","type":"invoice","format":"factur_x","content_type":"application/pdf","availability":"available","download_path":"/api/partner/v1/invoices/517/documents/pdf?shop_id=42"}
  ],
  "credit_notes": [
    {
      "id":518,
      "reference":"AV-518",
      "issued_at":"2026-10-18T14:50:00+02:00",
      "documents":[
        {"id":"pdf","type":"credit_note","format":"pdf","content_type":"application/pdf","availability":"unavailable","download_path":null}
      ],
      "transmission":{"pennylane":{"status":"pending","records":[{"status":"pending","reference":null,"updated_at":"2026-10-18T15:10:00+02:00"}]}}
    }
  ],
  "transmission":{"pennylane":{"status":"sent","records":[{"status":"sent","reference":"PL-928","updated_at":"2026-10-18T15:00:00+02:00"}]}}
}
```

Request-level read errors are reported as MCP errors with a structured `error.code` and `error.message`. A missing resource returns `not_found`. A temporary service failure returns `unavailable`. Source-level availability is reported within a successful result.

Run the local transport tests with `node --import tsx --test tests/partner-reads.test.mjs`.
