import { relations } from 'drizzle-orm'
import {
  boolean,
  decimal,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const menuCategories = pgTable('menu_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const menuCategoriesRelations = relations(
  menuCategories,
  ({ many }) => ({
    items: many(menuItems),
  }),
)

export const menuItems = pgTable('menu_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  categoryId: uuid('category_id')
    .references(() => menuCategories.id)
    .notNull(),
  name: text('name').notNull(),
  description: text('description'),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  image: text('image'),
  isAvailable: boolean('is_available').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  category: one(menuCategories, {
    fields: [menuItems.categoryId],
    references: [menuCategories.id],
  }),
  modifiers: many(modifiers),
}))

export const modifiers = pgTable('modifiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  menuItemId: uuid('menu_item_id')
    .references(() => menuItems.id)
    .notNull(),
  name: text('name').notNull(),
  priceAdjustment: decimal('price_adjustment', {
    precision: 10,
    scale: 2,
  }).default('0.00'),
  isRequired: boolean('is_required').default(false),
  createdAt: timestamp('created_at').defaultNow(),
})

export const modifierRelations = relations(modifiers, ({ one }) => ({
  menuItem: one(menuItems, {
    fields: [modifiers.menuItemId],
    references: [menuItems.id],
  }),
}))
