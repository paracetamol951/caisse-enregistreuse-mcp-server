export const KASH_SPEC = `
# KASH.CLICK — Agent Specification

## Authentication
- Call account_list to find existing accounts by email
- Call auth_request_otp then auth_login_with_otp to authenticate
- Session is stored automatically after login

## Payment Values
order_create: omit payment or use 0 or -2 to save an unpaid quote. Use a positive payment method ID to collect a payment.
In STDIO, order_create also accepts -1 to validate an unpaid invoice directly.
order_edit: use -2 for a pending quote, -1 to validate an unpaid invoice, or 0 to edit without collecting. Use a positive payment method ID to collect a payment.
On an unvalidated order, order_edit appends the supplied items and keeps the existing lines.
Find payment method IDs with data_list_payments_modes. Record a payment only when its status is confirmed.

For a partial payment, set paymentAmount to the positive amount actually collected, for example "12.50". With a positive method, omitting paymentAmount uses the worker default. An explicit zero is rejected.

## Delivery Methods
0 = Takeaway
1 = Delivery
2 = On-site
3 = Drive-through
4 = Counter sale
5 = Pickup point
6 = Shipping

Default to 2 (on-site) if context is unknown.

## Item Format in Sales
- Existing catalog item:        productId (use order_create with type='catalog')
- Department item with price:   type='dept' + departmentId + price
- Free one-off item:            type='free' + title + price

Prefer catalog items over free items — free items reduce reporting quality.

## VAT Hierarchy (automatic, no manual calculation needed)
1. Item VAT (highest priority)
2. Department VAT (fallback)
3. Shop default VAT (fallback)

Free items without department → shop default VAT applies.
Free items with department → department VAT applies.

## Order State Transitions
Create the order once with order_create. Use order_edit on its orderID to validate an unpaid invoice or record each subsequent payment. A partial payment can leave a balance due.

## Sale Retries
Before order_create or order_edit, save a client-generated idempotencyKey such as a UUID, together with the complete arguments. After a timeout or unknown outcome, retry with the same key and arguments in the same shop and transport. For OAuth, keep the same OAuth client and Kash profile. Use a distinct key for each operation, including each partial payment.

A successful replay returns replayed: true. Use orderID when available to check the order and its payments after an unresolved result. If Kash reports a conflict, compare with the original operation before proceeding. If Kash reports idempotency_unavailable, the attempt did not start and you can retry with the same key and arguments.

## Agent Rules — MUST follow
1. Always retrieve existing clients before creating new ones (email = unique identifier)
2. Always retrieve existing products before creating new ones
3. Reuse catalog items whenever possible — avoid free items for recurring products
4. Never duplicate clients or items
5. Always verify VAT rates exist before creating sales
6. Never mark as paid unless explicitly confirmed

## Agent Rules — SHOULD follow
1. Attach a client to every sale when possible
2. Assign a department to every free item for better reporting
3. Confirm important actions with the user (payment, client creation)
4. Summarize actions performed after completing a workflow

## Free Plan Limits
- Max 500 items (products)
- Max 500 sales per month
Monitor item count before creating new catalog entries.

## Invoicing
Validating an unpaid invoice with order_edit uses payment = -1. A positive payment method records a payment and returns an invoice link.
PDF and Factur-X compliant invoices are generated automatically.

### Invoice prerequisites — check before issuing any invoice
Before validating an unpaid invoice or recording a payment with a positive method,
call account_show_infos and verify these three fields are non-empty:
- shopName              → the legal name of the establishment
- adressline1           → the street address
- companyRegistrationNum → the company registration number (SIRET / RCS)

If any of these fields is missing or empty:
1. Warn the user that the invoice may not be legally valid
2. Specify which field(s) are missing
3. Offer to set them immediately via account_edit
Do NOT silently emit an invoice with missing legal information.

## Shop Account Management
- account_show_infos : retrieve all current shop settings (no parameters needed)
- account_edit       : update any subset of shop settings (all fields optional)

Use account_show_infos proactively to inspect the shop configuration when:
- The user asks about their shop settings
- Before emitting invoices (check shopName, adressline1, companyRegistrationNum)
- Before enabling a feature the user may not have configured yet

## Reporting
Sales are aggregated by department, item, and payment method.
Always assign departments for accurate reporting.
Uncategorized items degrade report quality.
`.trim();
