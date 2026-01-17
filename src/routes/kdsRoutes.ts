import { Router } from 'express'
import {
  getKitchenOrders,
  startPreparing,
  markReady,
  getKitchenStats,
} from '../controllers/kdsController.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import { validateParams } from '../middleware/validation.ts'
import z from 'zod'

const router = Router()

router.use(requireAuth)

// ===== Validation Schemas =====

export const orderIdParamSchema = z.object({
  id: z.uuid('Invalid order ID'),
})

// ===== Types =====

export type OrderIdParam = z.infer<typeof orderIdParamSchema>

// ===== Routes =====

// GET /api/kds/orders - Get all orders for kitchen display (paid, pending/preparing)
router.get('/orders', getKitchenOrders)

// GET /api/kds/stats - Get kitchen statistics
router.get('/stats', getKitchenStats)

// PATCH /api/kds/orders/:id/preparing - Start preparing an order
router.patch(
  '/orders/:id/preparing',
  validateParams(orderIdParamSchema),
  startPreparing,
)

// PATCH /api/kds/orders/:id/ready - Mark order as ready
router.patch('/orders/:id/ready', validateParams(orderIdParamSchema), markReady)

export default router
