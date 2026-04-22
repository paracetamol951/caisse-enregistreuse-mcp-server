export const KASH_SPEC = `
# KASH.CLICK — Agent Specification

## Authentication
- Call account_list to find existing accounts by email
- Call auth_request_otp then auth_login_with_otp to authenticate
- Session is stored automatically after login

## Payment Values
-2 = Quote (not validated, not paid, can be modified)
-1 = Invoice (validated, not paid)
>=0 = Paid (value must be a valid payment method ID from data.list.payments_modes)

SAFETY RULE: Default to -1 (invoice) if payment status is uncertain.
NEVER use payment >= 0 unless explicitly confirmed as paid.

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
Quote (-2) → Invoice (-1) → Paid (payment method ID)
Use order_edit to transition. Do NOT recreate a sale to change its state.

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
Invoices are auto-generated when payment = -1 or >= 0.
Quotes (payment = -2) do NOT generate invoices.
PDF and Factur-X compliant invoices are generated automatically.

## Reporting
Sales are aggregated by department, item, and payment method.
Always assign departments for accurate reporting.
Uncategorized items degrade report quality.
`.trim();