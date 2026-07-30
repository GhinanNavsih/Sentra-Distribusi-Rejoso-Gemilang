# Unpaid Pre-Orders & Restock Demand Walkthrough

This walkthrough explains how operators create unpaid pre-orders, plan restocking from upcoming demand, receive purchased stock, and convert a pre-order into a completed paid sale.

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

1. Run the production build.
2. Confirm the build completes without syntax or compilation errors.
3. Confirm the deployment uses SPA routing so direct navigation to application routes returns the app shell.
4. After deployment, authenticate and repeat the verification checklist in the intended staging environment before using the workflow with production orders.
