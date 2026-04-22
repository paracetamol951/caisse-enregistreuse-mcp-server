export const KASH_CATALOG_GUIDE = `
# KASH — Catalog Guide

## Structure Hierarchy

Department Group → Department → Product (PLU)

- Department groups are optional organizational containers.
- Departments define default VAT, price, and variations for their products.
- Products (PLU) inherit from their department when no value is set directly.

## Products (PLU)

### Identification
- title: display name on POS and receipts
- shortTitle: compact label for keyboard buttons
- description: full description (webshop, customer-facing)
- barcode: EAN, QR, or any scannable code
- internalID: your own SKU or internal reference

### Pricing
- price: selling price
- buyingPrice: purchase/cost price (used for margin reporting only, never shown to customers)

### Organization
- deptID: parent department (REQUIRED for accurate VAT and reporting)
- position: display order on the POS keyboard
- supplierID: link to a supplier record

### Taxation
- vatID: VAT rate ID for standard / takeaway sales
- eatinvatID: VAT rate ID for eat-in sales (restaurant mode)
- If neither is set, the department VAT applies; if the department has none, the shop default applies.
- Never compute VAT manually — always use IDs from data_list_vats.

### Variations (up to 5 slots)
- variationID0 … variationID4: assign variation types to a product
- Each slot references a variation type (e.g. "Size", "Color")
- When recording a sale, pass the chosen variation choice IDs in the declinaisons array (max 5 choices per order line)
- Use data_list_variations to retrieve available variation types and their choices

### Visibility
- keyboardHide: 1 = hidden from POS touchscreen keyboard (still sellable by barcode or search)
- shopHide: 1 = hidden from online webshop (still available at physical POS)
- Use shopHide for in-store-only items; use keyboardHide for items sold exclusively online or by scan.

### Kitchen / Preparation
- needPrepa: 1 = product triggers a kitchen preparation ticket when ordered
- prepaLength: estimated preparation time in minutes (for scheduling)
- Set needPrepa at department level to apply to all products in that department by default.

### Stock Management
- stock: current inventory quantity
- stockAlert: threshold that triggers a low-stock alert
- consumptionDate: expiry or best-before date (ISO format recommended)
- Stock is decremented automatically when a sale is validated.
- Monitor free plan limit: max 500 products total.

### Accounting
- activityCode: accounting activity code for export to accounting software

## Departments

Departments group products and carry default settings inherited by their products.

### Key fields
- title: category name (e.g. "Beverages", "Pastries")
- shortTitle: compact label
- price: default price for free-price items in this department
- vatID / eatinvatID: default VAT rates (inherited by products unless overridden)
- deptGroupID: optional parent group
- position: display order on keyboard
- needPrepa: 1 = all products in this department require preparation by default
- variationID0 … variationID4: default variations inherited by products
- keyboardHide / shopHide: visibility flags (same as products)
- activityCode: accounting code

### Agent rules
1. Always assign a deptID when creating a product — uncategorized products degrade report quality.
2. Set VAT at the department level when all products share the same rate; override at product level only when needed.
3. Use deptGroupID to organize departments into logical sections (e.g. "Food", "Drinks").

## Variations System

### Concepts
- Variation type: a named attribute (e.g. "Size", "Sauce", "Cooking")
- Variation choice: a specific option within a type (e.g. "Small", "Medium", "Large")
- deltaPrice: price adjustment applied when a choice is selected (can be negative)
- ending: 1 = selecting this choice closes the variation selection flow immediately
- unavailable: 1 = choice is temporarily unavailable (shown greyed out)

### Setup workflow
1. variation_add → create the type (e.g. "Size")
2. variation_choice_add → add choices to the type (e.g. "S", "M", "L" with deltaPrices)
3. plu_add or dept_add → assign variationID0 … variationID4 with the type ID

### At sale time
- Pass chosen variation choice IDs in the declinaisons array on the order line.
- Maximum 5 declinaisons per order line.
- Price delta is applied automatically per choice.

## Agent Rules — Catalog

MUST:
1. Always check data_list_products before creating a new product to avoid duplicates.
2. Always check data_list_departments before creating a new department.
3. Assign a deptID to every product.
4. Use data_list_vats to resolve VAT IDs — never hardcode VAT values.

SHOULD:
1. Set needPrepa on the department rather than individual products when the whole category requires preparation.
2. Use shortTitle when title exceeds ~15 characters (improves POS display).
3. Set buyingPrice for products where margin tracking matters.
4. Prefer setting variations at the department level for consistency across products.
`.trim();