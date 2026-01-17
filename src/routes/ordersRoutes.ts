import { Router } from 'express'
import {
  addOrderItem,
  createOrder,
  deleteOrder,
  generateReceipt,
  getAllOrders,
  getOrderById,
  removeOrderItem,
  updateOrder,
  updateOrderStatus,
} from '../controllers/ordersController.ts'
import { adminMiddleware } from '../middleware/admin.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validation.ts'
import { createPayment } from '../controllers/paymentsController.ts'
import {
  createPaymentSchema,
  orderIdParamSchema as paymentOrderIdParamSchema,
} from './paymentsRoutes.ts'

import z from 'zod'

const router = Router()

router.use(requireAuth)

// ===== Validation Schemas =====

const orderStatusEnum = z.enum([
  'pending',
  'preparing',
  'ready',
  'completed',
  'canceled',
])
const orderTypeEnum = z.enum(['dine_in', 'takeaway', 'delivery'])

const selectedModifierSchema = z.object({
  name: z.string(),
  price: z.number().min(0).optional().default(0),
})

const orderItemSchema = z.object({
  menuItemId: z.uuid('Invalid menu item ID'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  notes: z.string().max(500).optional(),
  selectedModifiers: z.array(selectedModifierSchema).optional(),
})

export const createOrderSchema = z.object({
  tableId: z.uuid('Invalid table ID').optional(),
  tableNumber: z.string().min(1).max(20).optional(), // Simple string like "47", "A1"
  type: orderTypeEnum,
  items: z.array(orderItemSchema).min(1, 'At least one item is required'),
  notes: z.string().max(500).optional(),
})

export const updateOrderSchema = z.object({
  type: orderTypeEnum.optional(),
  tableId: z.uuid('Invalid table ID').nullable().optional(),
  tableNumber: z.string().min(1).max(20).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
})

export const updateOrderStatusSchema = z.object({
  status: orderStatusEnum,
})

export const addOrderItemSchema = orderItemSchema

export const orderIdParamSchema = z.object({
  id: z.uuid('Invalid order ID'),
})

export const orderItemIdParamSchema = z.object({
  id: z.uuid('Invalid order ID'),
  itemId: z.uuid('Invalid order item ID'),
})

export const orderQuerySchema = z.object({
  status: orderStatusEnum.optional(),
  type: orderTypeEnum.optional(),
  tableId: z.uuid().optional(),
  tableNumber: z.string().optional(),
  isPaid: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
})

// ===== Routes =====

// GET routes - accessible by all authenticated users
router.get('/', validateQuery(orderQuerySchema), getAllOrders)
router.get('/:id', validateParams(orderIdParamSchema), getOrderById)

// Order management - cashier
router.post('/', validateBody(createOrderSchema), createOrder)
router.put(
  '/:id',
  validateParams(orderIdParamSchema),
  validateBody(updateOrderSchema),
  updateOrder,
)

// Delete - admin only
router.delete(
  '/:id',
  adminMiddleware,
  validateParams(orderIdParamSchema),
  deleteOrder,
)

// Status update - cashier/kitchen
router.patch(
  '/:id/status',
  validateParams(orderIdParamSchema),
  validateBody(updateOrderStatusSchema),
  updateOrderStatus,
)

// Order items management - cashier
router.post(
  '/:id/items',
  validateParams(orderIdParamSchema),
  validateBody(addOrderItemSchema),
  addOrderItem,
)
router.delete(
  '/:id/items/:itemId',
  validateParams(orderItemIdParamSchema),
  removeOrderItem,
)

// Payment for order - cashier
router.post(
  '/:id/payment',
  validateParams(orderIdParamSchema),
  validateBody(createPaymentSchema),
  createPayment,
)

// Receipt generation - cashier
router.get('/:id/receipt', validateParams(orderIdParamSchema), generateReceipt)

// ===== Types =====

export type CreateOrderBody = z.infer<typeof createOrderSchema>
export type UpdateOrderBody = z.infer<typeof updateOrderSchema>
export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusSchema>
export type AddOrderItemBody = z.infer<typeof addOrderItemSchema>
export type OrderIdParam = z.infer<typeof orderIdParamSchema>
export type OrderItemIdParam = z.infer<typeof orderItemIdParamSchema>
export type OrderQueryParams = z.infer<typeof orderQuerySchema>

export default router
