const pool = require('../config/database');

/**
 * Service de génération de données de test avec système d'offset
 */
class TestDataService {

  /**
   * Récupère les offsets actuels depuis app_config
   */
  async getOffsets() {
    const query = `
      SELECT config_key, config_value FROM app_config
      WHERE config_key IN ('test_customers_offset', 'test_products_offset', 'test_orders_offset')
    `;
    const result = await pool.query(query);

    const offsets = {
      customers: 0,
      products: 0,
      orders: 0
    };

    result.rows.forEach(row => {
      if (row.config_key === 'test_customers_offset') {
        offsets.customers = parseInt(row.config_value) || 0;
      } else if (row.config_key === 'test_products_offset') {
        offsets.products = parseInt(row.config_value) || 0;
      } else if (row.config_key === 'test_orders_offset') {
        offsets.orders = parseInt(row.config_value) || 0;
      }
    });

    return offsets;
  }

  /**
   * Met à jour un offset spécifique
   */
  async updateOffset(type, newOffset) {
    const configKey = `test_${type}_offset`;
    const query = `
      INSERT INTO app_config (config_key, config_value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (config_key)
      DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
    `;
    await pool.query(query, [configKey, newOffset.toString()]);
  }

  /**
   * Reset tous les offsets à 0
   */
  async resetOffsets() {
    const types = ['customers', 'products', 'orders'];
    for (const type of types) {
      await this.updateOffset(type, 0);
    }
    return { success: true, message: 'Offsets réinitialisés' };
  }

  /**
   * Génère des clients de test
   */
  generateCustomers(count, startOffset) {
    const customers = [];
    const firstNames = ['Pierre', 'Marie', 'Jean', 'Sophie', 'Luc', 'Emma', 'Thomas', 'Julie', 'Marc', 'Laura', 'Nicolas', 'Camille', 'Alexandre', 'Léa', 'David'];
    const lastNames = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David'];
    const domains = ['gmail.com', 'hotmail.fr', 'yahoo.fr', 'outlook.com', 'free.fr'];

    for (let i = 0; i < count; i++) {
      const id = startOffset + i + 1;
      const firstName = firstNames[i % firstNames.length];
      const lastName = lastNames[i % lastNames.length];
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${id}@${domains[i % domains.length]}`;

      customers.push({
        customer_id: id,
        email: email,
        first_name: firstName,
        last_name: lastName,
        phone: `+336${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
        username: `${firstName.toLowerCase()}${id}`,
        date_created: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
        total_spent: Math.floor(Math.random() * 1000),
        order_count: Math.floor(Math.random() * 20),
        billing_address: {
          first_name: firstName,
          last_name: lastName,
          address_1: `${Math.floor(Math.random() * 200)} Rue de Test`,
          city: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice'][i % 5],
          postcode: String(Math.floor(Math.random() * 90000) + 10000),
          country: 'FR'
        },
        shipping_address: {
          first_name: firstName,
          last_name: lastName,
          address_1: `${Math.floor(Math.random() * 200)} Rue de Test`,
          city: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice'][i % 5],
          postcode: String(Math.floor(Math.random() * 90000) + 10000),
          country: 'FR'
        }
      });
    }

    return customers;
  }

  /**
   * Génère des produits de test
   */
  generateProducts(count, startOffset) {
    const products = [];
    const categories = ['E-liquides', 'Cigarettes électroniques', 'Accessoires', 'DIY', 'CBD'];
    const brands = ['VapeKing', 'CloudMaster', 'FlavourPro', 'PureVape', 'TechVape'];
    const productTypes = ['Pod', 'Mod', 'Clearomiseur', 'Résistances', 'E-liquide', 'Batterie', 'Chargeur'];

    for (let i = 0; i < count; i++) {
      const id = startOffset + i + 1;
      const type = productTypes[i % productTypes.length];
      const brand = brands[i % brands.length];
      const name = `${brand} ${type} ${id}`;
      const price = Math.floor(Math.random() * 50) + 10;
      const costPrice = Math.floor(price * 0.6);

      products.push({
        product_id: id,
        sku: `TEST-${String(id).padStart(5, '0')}`,
        name: name,
        price: price,
        regular_price: price + 5,
        sale_price: price,
        cost_price: costPrice,
        stock_quantity: Math.floor(Math.random() * 100),
        stock_status: Math.random() > 0.2 ? 'instock' : 'outofstock',
        category: categories[i % categories.length],
        categories: [categories[i % categories.length]],
        date_created: new Date(Date.now() - Math.random() * 180 * 24 * 60 * 60 * 1000).toISOString(),
        date_modified: new Date().toISOString(),
        total_sales: Math.floor(Math.random() * 100),
        image_url: `https://via.placeholder.com/300x300.png?text=${encodeURIComponent(name)}`
      });
    }

    return products;
  }

  /**
   * Génère des commandes de test
   */
  generateOrders(count, startOffset, availableCustomers, availableProducts) {
    const orders = [];
    const statuses = ['pending', 'processing', 'completed', 'on-hold', 'cancelled'];
    const paymentMethods = ['card', 'paypal', 'bank_transfer'];
    const shippingMethods = ['flat_rate', 'free_shipping', 'local_pickup'];

    for (let i = 0; i < count; i++) {
      const id = startOffset + i + 1;
      const customerId = availableCustomers[i % availableCustomers.length];
      const itemsCount = Math.floor(Math.random() * 4) + 1;
      const status = statuses[Math.floor(Math.random() * statuses.length)];

      // Génère les items
      const lineItems = [];
      let subtotal = 0;

      for (let j = 0; j < itemsCount; j++) {
        const product = availableProducts[Math.floor(Math.random() * availableProducts.length)];
        const quantity = Math.floor(Math.random() * 3) + 1;
        const price = product.price || 20;
        const itemTotal = price * quantity;

        lineItems.push({
          product_id: product.product_id,
          product_name: product.name,
          sku: product.sku,
          quantity: quantity,
          price: price,
          regular_price: product.regular_price || price,
          subtotal: itemTotal,
          total: itemTotal,
          discount: 0,
          cost_price: product.cost_price || Math.floor(price * 0.6),
          tax: Math.floor(itemTotal * 0.2)
        });

        subtotal += itemTotal;
      }

      const shippingTotal = Math.floor(Math.random() * 10) + 5;
      const taxTotal = Math.floor(subtotal * 0.2);
      const total = subtotal + shippingTotal + taxTotal;

      orders.push({
        order_id: id,
        order_number: String(10000 + id),
        status: status,
        total: total,
        subtotal: subtotal,
        shipping_total: shippingTotal,
        discount_total: 0,
        tax_total: taxTotal,
        payment_method: paymentMethods[i % paymentMethods.length],
        payment_method_title: paymentMethods[i % paymentMethods.length].toUpperCase(),
        currency: 'EUR',
        date_created: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
        date_completed: status === 'completed' ? new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000).toISOString() : null,
        date_modified: new Date().toISOString(),
        customer_id: customerId,
        shipping_method: shippingMethods[i % shippingMethods.length],
        shipping_method_title: 'Livraison standard',
        shipping_country: 'FR',
        billing_address: {
          first_name: 'Test',
          last_name: 'User',
          address_1: `${Math.floor(Math.random() * 200)} Rue de Test`,
          city: 'Paris',
          postcode: '75001',
          country: 'FR'
        },
        shipping_address: {
          first_name: 'Test',
          last_name: 'User',
          address_1: `${Math.floor(Math.random() * 200)} Rue de Test`,
          city: 'Paris',
          postcode: '75001',
          country: 'FR'
        },
        customer_note: '',
        line_items: lineItems,
        coupon_lines: []
      });
    }

    return orders;
  }

  /**
   * Génère et envoie un lot de données de test
   */
  async generateTestData(counts) {
    const { customers: customersCount = 0, products: productsCount = 0, orders: ordersCount = 0 } = counts;

    // Récupère les offsets actuels
    const offsets = await this.getOffsets();

    const result = {
      customers: null,
      products: null,
      orders: null,
      offsets_used: { ...offsets },
      new_offsets: {}
    };

    // Génère les clients
    if (customersCount > 0) {
      result.customers = this.generateCustomers(customersCount, offsets.customers);
      result.new_offsets.customers = offsets.customers + customersCount;
      await this.updateOffset('customers', result.new_offsets.customers);
    }

    // Génère les produits
    if (productsCount > 0) {
      result.products = this.generateProducts(productsCount, offsets.products);
      result.new_offsets.products = offsets.products + productsCount;
      await this.updateOffset('products', result.new_offsets.products);
    }

    // Génère les commandes (nécessite des clients et produits existants)
    if (ordersCount > 0) {
      // Récupère quelques clients et produits depuis la DB
      const customersResult = await pool.query('SELECT customer_id FROM customers ORDER BY customer_id DESC LIMIT 20');
      const productsResult = await pool.query('SELECT product_id, name, sku, price, cost_price, regular_price FROM products ORDER BY product_id DESC LIMIT 20');

      const availableCustomers = customersResult.rows.map(r => r.customer_id);
      const availableProducts = productsResult.rows;

      if (availableCustomers.length === 0) {
        result.orders = { error: 'Aucun client disponible pour générer des commandes' };
      } else if (availableProducts.length === 0) {
        result.orders = { error: 'Aucun produit disponible pour générer des commandes' };
      } else {
        result.orders = this.generateOrders(ordersCount, offsets.orders, availableCustomers, availableProducts);
        result.new_offsets.orders = offsets.orders + ordersCount;
        await this.updateOffset('orders', result.new_offsets.orders);
      }
    }

    return result;
  }
}

module.exports = new TestDataService();
