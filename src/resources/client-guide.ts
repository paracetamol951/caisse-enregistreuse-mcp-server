export const KASH_CLIENT_GUIDE = `
# KASH — Client / CRM Guide

## Identity Fields

- title: honorific or type label (e.g. "Mr", "Mrs", "Company", "Association")
- name: first name
- surname: last name
- email: primary unique identifier — always search by email before creating (data.list.clients)
- birthDate: date of birth in YYYY-MM-DD format or Unix timestamp

## Contact

- phone: primary phone number
- phone2: secondary phone number
- barcode: loyalty card barcode — used for scanning at POS to identify the customer

## Address

- addressline1: street address line 1
- addressline2: street address line 2 (apartment, building, etc.)
- postcode: postal / ZIP code
- city: city
- country: country name or ISO code
- adressComment: delivery instructions (e.g. "Ring bell B", "Leave at door")
- lat / lng: GPS coordinates — set these when delivery accuracy matters (e.g. for a delivery zone check or map display)

## Business / Company Fields

Use these when the customer is a legal entity rather than an individual.

- registrationNumber: company registration number (SIRET in France, or equivalent)
- VATnum: intra-community VAT number (for B2B invoicing)
- identificationID: national ID or passport number (for regulated sectors)
- activityCode: accounting activity code for export to accounting software

## Notes

- commentPrivate: internal staff-only note (never shown to the customer)
- commentPublic: note visible to the customer (e.g. on delivery slips or invoices)

## Segmentation

- clientGroupID: assign the customer to a group/segment (e.g. "VIP", "Wholesale")
  Retrieve available groups from data.list.clients or the back-office.
- position: sort order within the customer list (lower = displayed first)

## Moderation

- blacklist: set to 1 to flag a customer as blacklisted
  Blacklisted customers remain in the system but are flagged visually at POS.
  Use commentPrivate to document the reason.

## Agent Rules — Clients

MUST:
1. Always call data.list.clients (filter by email) before creating a new client.
   Email is the unique identifier — duplicate clients corrupt sales history and loyalty data.
2. Never create a client without at least one identifying field (email, phone, or name).
3. Never delete a client who has associated sales — use blacklist instead.

SHOULD:
1. Attach a client to every sale when possible — enables loyalty tracking and personalized invoices.
2. Set lat/lng when the customer has a delivery address — improves delivery zone matching.
3. Use commentPrivate for internal flags (payment issues, preferences) rather than abusing the blacklist.
4. Fill in registrationNumber and VATnum for business customers — required for valid B2B invoices.
5. Confirm with the user before creating a new client if a match with a similar name or email already exists.
`.trim();