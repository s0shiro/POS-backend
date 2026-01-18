import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const tableStatusEnum = pgEnum('table_status', [
  'available',
  'occupied',
  'reserved',
])

export const tables = pgTable('tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: text('number').notNull().unique(), // e.g., "1", "12A"
  capacity: integer('capacity').notNull(),
  status: tableStatusEnum('status').default('available'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date()),
})
