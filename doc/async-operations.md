# Asynchronous Kash operations

The MCP server queues CSV sales exports and prepares CSV catalog imports through the Kash partner API. Existing synchronous tools remain available.

| Tool | Kash permission | Effect |
| --- | --- | --- |
| `export_sales_async` | `reports.read` | Queues a CSV of validated sales. |
| `prepare_catalog_import` | `catalog.read` | Queues a preview of the catalog changes and line errors. |
| `confirm_catalog_import` | `catalog.write` | Queues application of a preview explicitly approved by the user. |
| `get_async_operation` | `reports.read` or `catalog.read` by kind | Reads status and summary. |
| `get_async_operation_result` | `reports.read` or `catalog.read` by kind | Retrieves a sales CSV or an import result page. |

HTTP uses the OAuth consent for the selected Kash shop. Keep the same consent grant when following an operation. If you plan to apply an import, grant both `catalog.read` and `catalog.write` before creating its preview. For STDIO, set `SHOPID` (or `MCP_SHOPID`) and `KASH_PARTNER_API_KEY` to a managed key for the shop with the relevant permissions. The STDIO tools appear when a managed key is configured. Keep the existing `APIKEY` configuration if you use legacy STDIO tools. Keep credentials, preview tokens, catalog inputs and sales files private.

## Export sales

Request an export of validated sales starting on `from` up to the day before `to` in the shop's local business dates. The maximum range is 366 days. Specify `cashbox_id` to restrict the report to one cashbox. Sales CSVs can be up to 4 MiB.

```json
{
  "name": "export_sales_async",
  "arguments": {
    "from": "2026-11-01",
    "to": "2026-11-08",
    "idempotencyKey": "ef15a0ff-b47d-48a0-87d0-90fa288dab2d"
  }
}
```

Read the operation ID from `structuredContent.id`. Poll until the operation reaches `succeeded`, then request the result.

```json
{
  "name": "get_async_operation",
  "arguments": { "operationId": "0123456789abcdef0123456789abcdef", "operationKind": "export" }
}
```

```json
{
  "name": "get_async_operation_result",
  "arguments": { "operationId": "0123456789abcdef0123456789abcdef", "operationKind": "export" }
}
```

Read the CSV from the embedded MCP resource's `blob` field as Base64. The filename, media type and SHA-256 are in `structuredContent`. Use a client that supports embedded file resources if you want to save the file.

## Preview and apply a catalog import

Encode the original CSV bytes as Base64. Kash accepts up to 1 MiB decoded, UTF-8 with an optional BOM, and comma, semicolon or tab delimiters. The required headers are `reference`, `name`, `price`, `vat_id`, and `department_id`. The `id` header is optional. Use VAT and department IDs from the selected shop. The example encodes one sample article.

```json
{
  "name": "prepare_catalog_import",
  "arguments": {
    "contentBase64": "cmVmZXJlbmNlO25hbWU7cHJpY2U7dmF0X2lkO2RlcGFydG1lbnRfaWQKREVNTy0wMTtDb2ZmZWU7My41MDsxOzQK",
    "idempotencyKey": "80335a18-fd9e-4f0b-849a-7548b4929d65"
  }
}
```

Poll `get_async_operation` with the returned ID and `operationKind: "import"`. At `awaiting_confirmation`, read the summary and preview token. Fetch the preview rows and review planned changes and errors with the user.

```json
{
  "name": "get_async_operation_result",
  "arguments": {
    "operationId": "fedcba9876543210fedcba9876543210",
    "operationKind": "import",
    "limit": 100
  }
}
```

For every additional page, send its preceding `nextAfter` value as `after`. A null value marks the last page. If the user approves applying the valid rows from this preview, call:

```json
{
  "name": "confirm_catalog_import",
  "arguments": {
    "operationId": "fedcba9876543210fedcba9876543210",
    "previewToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "apply": true
  }
}
```

Poll the same operation again and retrieve its result pages. They show what happened on each line, including errors. The preview alone leaves the catalog untouched.

## Status and retries

`queued` and `running` indicate work in progress. `awaiting_confirmation` means the import preview is ready for review. `succeeded`, `partial`, `failed` and `expired` are terminal. For `partial`, some import rows succeeded or were skipped and others failed. If every catalog row was rejected in the preview, the operation is `failed` and its result lists the errors. Read the status for the reason an operation failed.

A preview can be confirmed for 24 hours. Terminal results are available for 24 hours, then the expired record remains visible for seven more days. See `expiresAt` on the operation.

If the network drops after a submission, retry with the original idempotency key and the same arguments to recover the same operation. Use a fresh key for a new export or preview. If confirmation times out, check status first. A repeat confirmation using the same operation ID and preview token does not reapply rows.
