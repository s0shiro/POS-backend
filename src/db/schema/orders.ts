import {
  boolean,
  decimal,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tables } from './tables.ts'
import { user } from './auth.ts'
import { relations } from 'drizzle-orm'
import { menuItems } from './menu.ts'

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'preparing',
  'ready',
  'completed',
  'canceled',
])
export const orderTypeEnum = pgEnum('order_type', [
  'dine_in',
  'takeaway',
  'delivery',
])
export const paymentMethodEnum = pgEnum('payment_method', [
  'cash',
  'card',
  'digital_wallet',
])
export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'paid',
  'refunded',
  'failed',
])

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderNumber: text('order_number').notNull().unique(),
  tableId: uuid('table_id').references(() => tables.id),
  tableNumber: text('table_number'), // Simple string for McDonald's-style (e.g., "47")
  userId: text('user_id').references(() => user.id),
  status: orderStatusEnum('status').default('pending'),
  type: orderTypeEnum('type').default('dine_in'),
  isPaid: boolean('is_paid').default(false).notNull(), // Kitchen only sees paid orders
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 })
    .notNull()
    .default('0.00'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const ordersRelations = relations(orders, ({ one, many }) => ({
  table: one(tables, {
    fields: [orders.tableId],
    references: [tables.id],
  }),
  createdBy: one(user, {
    fields: [orders.userId],
    references: [user.id],
  }),
  items: many(orderItems),
  payment: one(payments),
}))

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .references(() => orders.id, { onDelete: 'cascade' })
    .notNull(),
  menuItemId: uuid('menu_item_id')
    .references(() => menuItems.id)
    .notNull(),
  quantity: integer('quantity').notNull().default(1),
  priceAtTime: decimal('price_at_time', { precision: 10, scale: 2 }).notNull(),
  notes: text('notes'),
  selectedModifiers: jsonb('selected_modifiers'),
})

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  menuItem: one(menuItems, {
    fields: [orderItems.menuItemId],
    references: [menuItems.id],
  }),
}))

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .references(() => orders.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  method: paymentMethodEnum('method').notNull(),
  status: paymentStatusEnum('status').default('pending'),
  // Payment details for receipt
  discount: decimal('discount', { precision: 10, scale: 2 }),
  discountType: text('discount_type'), // 'fixed' or 'percentage'
  tax: decimal('tax', { precision: 5, scale: 2 }),
  serviceCharge: decimal('service_charge', { precision: 5, scale: 2 }),
  receivedAmount: decimal('received_amount', { precision: 10, scale: 2 }),
  change: decimal('change', { precision: 10, scale: 2 }),
  refundReason: text('refund_reason'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, {
    fields: [payments.orderId],
    references: [orders.id],
  }),
}))
