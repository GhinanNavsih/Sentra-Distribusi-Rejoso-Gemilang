# Unpaid Pre-Orders & Restock Demand Walkthrough

This walkthrough explains how operators create unpaid pre-orders, plan restocking from upcoming demand, receive purchased stock, and convert a pre-order into a completed paid sale.

## Automatic product IDs

New products receive an ID automatically in the format `{word initials}_{4 uppercase alphanumeric characters}`. Words containing numbers are ignored, so `Beras Serang Dua Putri (25kg)` produces an ID beginning with `BSDP_`. Operators no longer type SKUs, and an existing product's generated ID cannot be changed because it is used by inventory and historical transactions.

## Core behavior

- A paid sale validates and deducts inventory immediately.
- An unpaid pre-order records planned demand without changing on-hand stock.
- Marking a pre-order as paid validates and deducts inventory atomically.
- If stock is insufficient, the order remains unpaid and the application displays the exact restock shortage for every affected product.
- Cancelling or editing an unpaid pre-order never restores or deducts physical stock.

## 1. Create an unpaid pre-order

1. Open **Kasir**.
2. Add products to the cart and choose the correct quantities and units.
3. Select the appropriate customer pricing tier.
4. In **Status Pembayaran**, select **Belum Lunas (Pre-Order)**.
5. Choose **Tanggal Target / Kirim**. The date must be today or later.
6. Enter **Nama Pelanggan / Catatan**.
7. Click **Simpan Pre-Order** and confirm.

Expected result:

- The order is saved with `payment_status: unpaid` and `status: unpaid`.
- The receipt shows **BELUM LUNAS / PRE-ORDER** and the target date.
- On-hand inventory is unchanged.

## 2. Review planned demand

1. Open **Inventori**.
2. Find **Perencanaan Pre-Order & Restock Demand**.
3. Review each product:

   - **Planned Demand** is the total base-unit quantity across active unpaid pre-orders.
   - **On-Hand Stock** is the current physical inventory.
   - **Defisit Stok** is `max(Planned Demand - On-Hand Stock, 0)`.
   - **Target** lists the requested delivery dates.

Rows with a shortage are highlighted in red. Fully covered demand is highlighted in green.

## 3. Import shortages into bulk purchasing

1. In the demand-planning section, click **Impor ke Restock Bulk Purchase**.
2. Confirm that the modal contains one row for each product with a shortage.
3. Each quantity is prefilled with the exact base-unit deficit.
4. Enter or verify supplier, unit cost, subtotal, and receipt attachment.
5. Click **Konfirmasi Penerimaan**.

Expected result:

- The purchase is recorded.
- Inventory increases by the received quantities.
- The demand table recalculates against the new on-hand stock.

Opening **Pembelian Grosir** from the normal inventory button keeps the regular saved draft behavior. Importing from demand planning intentionally replaces the current draft with the calculated shortage rows.

## 4. Find unpaid transactions

1. Open **Riwayat**.
2. Select a date range containing the pre-order creation date.
3. Click **Tampilkan Riwayat**.
4. Use the payment filter:

   - **Semua**
   - **Lunas**
   - **Belum Lunas (Pre-Order)**

Unpaid sales display an amber badge with their target date.

## 5. Mark a pre-order as paid

1. Locate the unpaid order in **Riwayat**.
2. Click **Tandai Lunas**.
3. Confirm the action.

If inventory is sufficient:

- Inventory is deducted inside the same Firestore transaction that updates the order.
- A `sale_paid` stock movement is recorded for every item.
- The order changes to `payment_status: paid` and `status: completed`.
- The order no longer contributes to planned demand.

If inventory is insufficient:

- No inventory or order status changes are committed.
- A shortage modal shows demanded, available, and missing base-unit quantities.
- Restock the displayed shortages and try **Tandai Lunas** again.

## 6. Print or download receipts

Unpaid receipts show:

- **BELUM LUNAS / PRE-ORDER**
- Target delivery date
- A notice that stock has not been released

These indicators are included in both receipt modals and generated PDF formats.

## 7. Verification checklist

### Unpaid creation

- Create a future-dated unpaid pre-order.
- Confirm the customer and target date are saved.
- Confirm inventory did not decrease.

### Demand planning

- Confirm all active unpaid order quantities are aggregated in base units.
- Confirm bulk-unit conversion is applied correctly.
- Confirm deficit equals planned demand minus on-hand stock, never below zero.

### Restock import

- Import deficits into bulk purchasing.
- Confirm products and exact base-unit shortages are prefilled.
- Complete the purchase and confirm inventory increases.

### Payment conversion

- Try marking an understocked pre-order as paid and confirm no partial changes occur.
- Restock the shortage.
- Mark the order as paid and confirm inventory decreases once.
- Confirm `sale_paid` movement logs exist.
- Confirm the order disappears from active demand planning.

### Regression checks

- Create a normal paid sale and confirm inventory is deducted immediately.
- Edit and cancel a paid sale and confirm existing stock-adjustment behavior remains intact.
- Edit or cancel an unpaid pre-order and confirm physical inventory is unchanged.

## Deployment validation

Before publishing:

1. Install both dependency sets with `npm install` and `npm --prefix functions install`.
2. Run `npm run lint`, `npm test`, `npm run test:inventory`, and `npm run build`.
3. Deploy the callable inventory functions first with `firebase deploy --only functions`.
4. Redeploy the web application, authenticate in staging, and smoke-test purchase, paid sale, manual adjustment, payment, cancellation, and repack flows.
5. Open **Log Pergerakan Stok** as a superadmin and run **Audit Konsistensi**. Investigate every reported anomaly before continuing.
6. Deploy the restrictive rules only after the function-backed application is live with `firebase deploy --only firestore:rules`. Deploying these rules first disables the legacy browser-side inventory writes.
7. Repeat the smoke test and consistency audit in production.

To refresh staging data before validation, authenticate Application Default Credentials and run `npm run migrate:staging`. The script requires typing the configured Firebase project ID and copies production operational collections into their `*_test` equivalents without deleting production data.

## Product ID migration

The product ID migration is intentionally dry-run by default. It scans production and staging, validates product aliases and every historical reference, and reports the proposed mapping without changing data:

```bash
GOOGLE_CLOUD_PROJECT=warehouse-375 npm run migrate:product-ids -- --environment=all --report=product-id-plan.json
```

The dry run reconciles historical references using the stored product name. Reused IDs are resolved per transaction, and genuinely missing products are represented by archived, zero-stock product records. Review the `errors`, `archived_products`, `reconciliations`, and stock totals in the report before continuing.

Create a Firestore backup/export and run apply mode only during a maintenance window, using the exact reviewed report as the plan:

```bash
GOOGLE_CLOUD_PROJECT=warehouse-375 npm run migrate:product-ids -- --environment=all --apply --confirm --plan=product-id-plan.json --report=product-id-apply-report.json
```

Apply mode requires the reviewed `--plan` so randomly generated IDs and reference resolutions cannot change between dry run and production. The migration preserves old identifiers as `legacy_sku`/`legacy_product_id`, keeps stock quantities unchanged, rewrites historical references, creates an audit manifest, and deletes old product/inventory document IDs only after the new records are written.

If an older migration converted Firestore timestamps into plain `_seconds`/`_nanoseconds` maps, repair them with a dry run first:

```bash
GOOGLE_CLOUD_PROJECT=warehouse-375 npm run repair:migration-timestamps -- --environment=production --report=production-timestamp-repair-plan.json
```

Review the affected collection counts, then run the repair during a maintenance window:

```bash
GOOGLE_CLOUD_PROJECT=warehouse-375 npm run repair:migration-timestamps -- --environment=production --apply --confirm --report=production-timestamp-repair-apply.json
```

The repair changes only timestamp-shaped maps back into Firestore `Timestamp` values, preserves document IDs and other fields, verifies the document count and stock total, and records a repair manifest.
