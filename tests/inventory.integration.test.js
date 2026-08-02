import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { deleteApp } from 'firebase/app';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'demo-sdrg';
let testEnvironment;
let clientApp;
let auth;
let functions;
let clientDb;

const jakartaDate = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const operation = async (name, payload) => {
  const callable = httpsCallable(functions, name);
  const response = await callable({ environment: 'staging', ...payload });
  return response.data;
};

const seed = async (callback) => testEnvironment.withSecurityRulesDisabled(async context => callback(context.firestore()));

const seedProduct = async (firestore, id, overrides = {}) => {
  await setDoc(doc(firestore, 'products_test', id), {
    sku: id,
    name: id,
    base_unit: 'pcs',
    bulk_unit_name: 'Box',
    bulk_unit_conversion: 10,
    cost_price: 100,
    price_star: 100,
    price_regular: 150,
    price_premium: 130,
    active: true,
    ...overrides
  });
};

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
  clientApp = initializeApp({ projectId, apiKey: 'demo-key', appId: 'demo-app' }, 'inventory-integration');
  auth = getAuth(clientApp);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  await signInAnonymously(auth);
  await seed(async firestore => {
    await setDoc(doc(firestore, 'users', auth.currentUser.uid), { role: 'superadmin' });
  });
  functions = getFunctions(clientApp, 'asia-southeast2');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  clientDb = testEnvironment.authenticatedContext(auth.currentUser.uid).firestore();
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seed(async firestore => {
    await setDoc(doc(firestore, 'users', auth.currentUser.uid), { role: 'superadmin' });
  });
});

afterAll(async () => {
  await deleteApp(clientApp);
  await testEnvironment.cleanup();
});

describe('server-authoritative inventory operations', () => {
  it('creates products with server-generated immutable IDs', async () => {
    const created = await operation('createProduct', {
      operation_id: 'product_create_001',
      product: {
        name: 'Beras Serang Dua Putri (25kg)',
        base_unit: 'pcs',
        bulk_unit_name: 'Sack',
        bulk_unit_conversion: 25,
        cost_price: 100,
        price_regular: 150,
        price_premium: 130,
        price_star: 100,
        category: 'Beras'
      }
    });

    expect(created.sku).toMatch(/^BSDP_[A-Z0-9]{4}$/);
    await seed(async firestore => {
      const product = await getDoc(doc(firestore, 'products_test', created.product_id));
      expect(product.data().sku).toBe(created.sku);
    });

    await expect(operation('createProduct', {
      operation_id: 'product_create_002',
      product: { name: 'Manual ID', base_unit: 'pcs', sku: 'USER_TYPED' }
    })).rejects.toThrow();

    await expect(setDoc(doc(clientDb, 'products_test', 'USER_TYPED'), {
      sku: 'USER_TYPED',
      name: 'Direct write',
      active: true
    })).rejects.toThrow();
  });

  it('receives a purchase atomically and applies an idempotent operation once', async () => {
    await seed(async firestore => seedProduct(firestore, 'A'));
    const payload = {
      operation_id: 'purchase_atomic_001',
      items: [{ product_id: 'A', qty: 2, unit_kind: 'bulk', cost_per_unit: 900 }],
      supplier_name: 'Supplier'
    };

    const first = await operation('receivePurchase', payload);
    const second = await operation('receivePurchase', payload);
    expect(second.purchase_id).toBe(first.purchase_id);

    await seed(async firestore => {
      expect((await getDoc(doc(firestore, 'inventory_test', 'A'))).data().current_stock_base).toBe(20);
      expect((await getDoc(doc(firestore, 'purchases_test', first.purchase_id))).exists()).toBe(true);
    });
  });

  it('aggregates duplicate purchase rows before changing stock', async () => {
    await seed(async firestore => seedProduct(firestore, 'A'));
    const purchase = await operation('receivePurchase', {
      operation_id: 'purchase_duplicate_001',
      items: [
        { product_id: 'A', qty: 3, unit_kind: 'base', cost_per_unit: 100 },
        { product_id: 'A', qty: 1, unit_kind: 'bulk', cost_per_unit: 900 }
      ]
    });

    await seed(async firestore => {
      expect((await getDoc(doc(firestore, 'inventory_test', 'A'))).data().current_stock_base).toBe(13);
      const purchaseData = (await getDoc(doc(firestore, 'purchases_test', purchase.purchase_id))).data();
      expect(purchaseData.items).toHaveLength(1);
      expect(purchaseData.items[0].base_qty).toBe(13);
    });
  });

  it('allocates after existing IDs when a migrated purchase counter is stale', async () => {
    const date = jakartaDate();
    const existingId = `PUR-${date}-0003`;
    await seed(async firestore => {
      await seedProduct(firestore, 'A');
      await setDoc(doc(firestore, 'purchases_test', existingId), { id: existingId, marker: 'preserve-me' });
      await setDoc(doc(firestore, 'counters_test', `purchases_${date}`), { count: 2 });
    });

    const purchase = await operation('receivePurchase', {
      operation_id: 'purchase_stale_counter_0001',
      items: [{ product_id: 'A', qty: 1, unit_kind: 'base', cost_per_unit: 100 }]
    });

    expect(purchase.purchase_id).toBe(`PUR-${date}-0004`);
    await seed(async firestore => {
      expect((await getDoc(doc(firestore, 'purchases_test', existingId))).data().marker).toBe('preserve-me');
    });
  });

  it('allows only one of two competing sales to consume limited stock', async () => {
    await seed(async firestore => {
      await seedProduct(firestore, 'A');
      await setDoc(doc(firestore, 'inventory_test', 'A'), { product_id: 'A', current_stock_base: 5 });
    });

    const sale = operationId => operation('createSale', {
      operation_id: operationId,
      order: {
        payment_status: 'paid',
        customer_type: 'regular',
        items: [{ product_id: 'A', qty: 4, selected_unit: 'base', unit_price: 150 }]
      }
    });
    const results = await Promise.allSettled([sale('sale_compete_0001'), sale('sale_compete_0002')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);

    await seed(async firestore => {
      expect((await getDoc(doc(firestore, 'inventory_test', 'A'))).data().current_stock_base).toBe(1);
    });
  });

  it('rejects a stale absolute stock adjustment', async () => {
    await seed(async firestore => {
      await seedProduct(firestore, 'A');
      await setDoc(doc(firestore, 'inventory_test', 'A'), { product_id: 'A', current_stock_base: 8 });
    });

    await expect(operation('adjustStock', {
      operation_id: 'stale_adjust_0001',
      product_id: 'A',
      expected_current_stock: 10,
      new_stock: 12,
      adjustment_kind: 'manual_purchase',
      cost_per_unit: 100
    })).rejects.toThrow(/Stok telah berubah/);
  });

  it('records manual purchases, sales, and losses with their linked documents', async () => {
    await seed(async firestore => {
      await seedProduct(firestore, 'A');
      await setDoc(doc(firestore, 'inventory_test', 'A'), { product_id: 'A', current_stock_base: 2 });
    });

    const purchase = await operation('adjustStock', {
      operation_id: 'manual_purchase_0001',
      product_id: 'A',
      expected_current_stock: 2,
      new_stock: 7,
      adjustment_kind: 'manual_purchase',
      cost_per_unit: 110
    });
    const sale = await operation('adjustStock', {
      operation_id: 'manual_sale_00000001',
      product_id: 'A',
      expected_current_stock: 7,
      new_stock: 6,
      adjustment_kind: 'manual_sale',
      price_tier: 'regular'
    });
    const loss = await operation('adjustStock', {
      operation_id: 'manual_loss_00000001',
      product_id: 'A',
      expected_current_stock: 6,
      new_stock: 5,
      adjustment_kind: 'stock_loss',
      reason: 'damaged'
    });

    await seed(async firestore => {
      expect((await getDoc(doc(firestore, 'inventory_test', 'A'))).data().current_stock_base).toBe(5);
      expect((await getDoc(doc(firestore, 'purchases_test', purchase.transaction_id))).exists()).toBe(true);
      expect((await getDoc(doc(firestore, 'orders_test', sale.transaction_id))).exists()).toBe(true);
      expect((await getDoc(doc(firestore, 'stock_losses_test', loss.transaction_id))).exists()).toBe(true);
    });
  });

  it('repacks stock atomically, rejects invalid pairs, and reports a healthy movement chain', async () => {
    await seed(async firestore => {
      await seedProduct(firestore, 'A', { name: 'Bulk A', bulk_unit_conversion: 10 });
      await seedProduct(firestore, 'B', { name: 'Loose B', bulk_unit_conversion: 1 });
      await setDoc(doc(firestore, 'inventory_test', 'A'), { product_id: 'A', current_stock_base: 2 });
      await setDoc(doc(firestore, 'inventory_test', 'B'), { product_id: 'B', current_stock_base: 1 });
    });

    const payload = {
      operation_id: 'repack_atomic_000001',
      from_sku: 'A',
      to_sku: 'B',
      qty_to_open: 1,
      conversion_rate: 10
    };
    await operation('repackStock', payload);
    await operation('repackStock', payload);
    await expect(operation('repackStock', {
      operation_id: 'repack_invalid_00001',
      from_sku: 'A',
      to_sku: 'A',
      qty_to_open: 1,
      conversion_rate: 10
    })).rejects.toThrow(/harus berbeda/i);

    const health = await operation('inventoryHealth', {});
    expect(health.anomalies).toEqual([]);
    await seed(async firestore => {
      expect((await getDoc(doc(firestore, 'inventory_test', 'A'))).data().current_stock_base).toBe(1);
      expect((await getDoc(doc(firestore, 'inventory_test', 'B'))).data().current_stock_base).toBe(11);
    });
  });

  it('uses stored bulk conversion for purchase edits and cancellation', async () => {
    await seed(async firestore => seedProduct(firestore, 'A'));
    const purchase = await operation('receivePurchase', {
      operation_id: 'bulk_purchase_0001',
      items: [{ product_id: 'A', qty: 1, unit_kind: 'bulk', cost_per_unit: 900 }]
    });
    await seed(async firestore => {
      await updateDoc(doc(firestore, 'products_test', 'A'), { bulk_unit_conversion: 20 });
    });
    await operation('editTransaction', {
      operation_id: 'bulk_purchase_edit_0001',
      transaction_id: purchase.purchase_id,
      transaction_type: 'purchase',
      items: [{ product_id: 'A', qty: 2, unit_kind: 'bulk', cost_per_unit: 900 }]
    });
    await operation('cancelTransaction', {
      operation_id: 'bulk_purchase_cancel_0001',
      transaction_id: purchase.purchase_id,
      transaction_type: 'purchase'
    });

    await seed(async firestore => {
      expect((await getDoc(doc(firestore, 'inventory_test', 'A'))).data().current_stock_base).toBe(0);
    });
  });

  it('rejects sale edits that would make stock negative and ignores price tampering', async () => {
    await seed(async firestore => {
      await seedProduct(firestore, 'A');
      await setDoc(doc(firestore, 'inventory_test', 'A'), { product_id: 'A', current_stock_base: 5 });
    });
    const sale = await operation('createSale', {
      operation_id: 'sale_edit_guard_0001',
      order: {
        payment_status: 'paid',
        customer_type: 'regular',
        items: [{ product_id: 'A', qty: 2, selected_unit: 'base', unit_price: 150 }]
      }
    });

    await expect(operation('editTransaction', {
      operation_id: 'sale_edit_negative_0001',
      transaction_id: sale.order_id,
      transaction_type: 'sale',
      items: [{ product_id: 'A', qty: 6, selected_unit: 'base', unit_price: 0 }]
    })).rejects.toThrow(/stok negatif/i);

    await operation('editTransaction', {
      operation_id: 'sale_edit_price_0001',
      transaction_id: sale.order_id,
      transaction_type: 'sale',
      items: [{ product_id: 'A', qty: 1, selected_unit: 'base', unit_price: 0 }]
    });

    await seed(async firestore => {
      expect((await getDoc(doc(firestore, 'inventory_test', 'A'))).data().current_stock_base).toBe(4);
      const order = (await getDoc(doc(firestore, 'orders_test', sale.order_id))).data();
      expect(order.items[0].unit_price).toBe(150);
      expect(order.items[0].qty).toBe(1);
    });
  });

  it('replaces unpaid preorder items without changing inventory', async () => {
    await seed(async firestore => {
      await seedProduct(firestore, 'A', { name: 'Original A' });
      await seedProduct(firestore, 'B', { name: 'Original B' });
      await seedProduct(firestore, 'C', { name: 'Added C' });
      await setDoc(doc(firestore, 'inventory_test', 'A'), { product_id: 'A', current_stock_base: 10 });
      await setDoc(doc(firestore, 'inventory_test', 'B'), { product_id: 'B', current_stock_base: 20 });
      await setDoc(doc(firestore, 'inventory_test', 'C'), { product_id: 'C', current_stock_base: 30 });
    });

    const preorder = await operation('createSale', {
      operation_id: 'preorder_edit_create_0001',
      order: {
        payment_status: 'unpaid',
        customer_type: 'regular',
        customer_name: 'Toko Lama',
        target_date: '9999-12-31',
        items: [
          { product_id: 'A', qty: 2, selected_unit: 'base', unit_price: 150 },
          { product_id: 'B', qty: 1, selected_unit: 'base', unit_price: 150 }
        ]
      }
    });

    await operation('editTransaction', {
      operation_id: 'preorder_edit_replace_0001',
      transaction_id: preorder.order_id,
      transaction_type: 'sale',
      items: [
        { product_id: 'B', qty: 3, selected_unit: 'base', unit_price: 150 },
        { product_id: 'C', qty: 2, selected_unit: 'base', unit_price: 150 }
      ],
      preorder: {
        customer_name: 'Toko Baru',
        customer_type: 'regular',
        target_date: '9999-12-31'
      }
    });

    await seed(async firestore => {
      const order = (await getDoc(doc(firestore, 'orders_test', preorder.order_id))).data();
      expect(order.payment_status).toBe('unpaid');
      expect(order.status).toBe('unpaid');
      expect(order.customer_name).toBe('Toko Baru');
      expect(order.items.map(item => item.product_id)).toEqual(['B', 'C']);
      expect(order.items.map(item => item.qty)).toEqual([3, 2]);
      expect((await getDoc(doc(firestore, 'inventory_test', 'A'))).data().current_stock_base).toBe(10);
      expect((await getDoc(doc(firestore, 'inventory_test', 'B'))).data().current_stock_base).toBe(20);
      expect((await getDoc(doc(firestore, 'inventory_test', 'C'))).data().current_stock_base).toBe(30);
    });
  });

  it('aggregates duplicate legacy preorder lines during payment and cancellation', async () => {
    await seed(async firestore => {
      await seedProduct(firestore, 'A');
      await setDoc(doc(firestore, 'inventory_test', 'A'), { product_id: 'A', current_stock_base: 10 });
      await setDoc(doc(firestore, 'orders_test', 'LEGACY-PREORDER'), {
        id: 'LEGACY-PREORDER',
        payment_status: 'unpaid',
        status: 'unpaid',
        revision: 1,
        items: [
          { product_id: 'A', product_name: 'A', qty: 2, base_qty: 2, base_unit: 'pcs', selected_unit: 'base' },
          { product_id: 'A', product_name: 'A', qty: 3, base_qty: 3, base_unit: 'pcs', selected_unit: 'base' }
        ]
      });
    });

    await operation('payPreorder', {
      operation_id: 'legacy_pay_duplicate_0001',
      order_id: 'LEGACY-PREORDER'
    });
    await operation('cancelTransaction', {
      operation_id: 'legacy_cancel_duplicate_0001',
      transaction_id: 'LEGACY-PREORDER',
      transaction_type: 'sale'
    });

    await seed(async firestore => {
      expect((await getDoc(doc(firestore, 'inventory_test', 'A'))).data().current_stock_base).toBe(10);
    });
  });

  it('rejects cancelling a purchase after its stock has already been consumed', async () => {
    await seed(async firestore => seedProduct(firestore, 'A'));
    const purchase = await operation('receivePurchase', {
      operation_id: 'purchase_cancel_guard_0001',
      items: [{ product_id: 'A', qty: 5, unit_kind: 'base', cost_per_unit: 100 }]
    });
    await operation('createSale', {
      operation_id: 'purchase_cancel_sale_0001',
      order: {
        payment_status: 'paid',
        customer_type: 'regular',
        items: [{ product_id: 'A', qty: 4, selected_unit: 'base', unit_price: 150 }]
      }
    });

    await expect(operation('cancelTransaction', {
      operation_id: 'purchase_cancel_reject_0001',
      transaction_id: purchase.purchase_id,
      transaction_type: 'purchase'
    })).rejects.toThrow(/stok negatif/i);

    await seed(async firestore => {
      expect((await getDoc(doc(firestore, 'inventory_test', 'A'))).data().current_stock_base).toBe(1);
      expect((await getDoc(doc(firestore, 'purchases_test', purchase.purchase_id))).data().status).toBe('completed');
    });
  });

  it('denies direct inventory writes and restricts order updates to receipt metadata', async () => {
    await expect(setDoc(doc(clientDb, 'inventory_test', 'A'), { current_stock_base: 99 })).rejects.toThrow();
    await seed(async firestore => {
      await setDoc(doc(firestore, 'orders_test', 'ORDER-1'), {
        status: 'completed',
        customer_name: '',
        payment_method: 'Cash',
        is_credit_sale: false
      });
    });
    await updateDoc(doc(clientDb, 'orders_test', 'ORDER-1'), { customer_name: 'Customer' });
    await expect(updateDoc(doc(clientDb, 'orders_test', 'ORDER-1'), { status: 'cancelled' })).rejects.toThrow();
  });
});
