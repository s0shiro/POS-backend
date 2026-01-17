import { Router } from 'express'
import {
  createPayment,
  getAllPayments,
  getPaymentById,
  processRefund,
  updatePayment,
} from '../controllers/paymentsController.ts'
import { adminMiddleware } from '../middleware/admin.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validation.ts'
import z from 'zod'

const router = Router()

router.use(requireAuth)

// ===== Validation Schemas =====

const paymentMethodEnum = z.enum(['cash', 'card', 'digital_wallet'])
const paymentStatusEnum = z.enum(['pending', 'paid', 'refunded', 'failed'])
const discountTypeEnum = z.enum(['fixed', 'percentage'])

export const createPaymentSchema = z.object({
  method: paymentMethodEnum,
  receivedAmount: z.number().min(0).optional(), // Amount customer paid (for cash, to calculate change)
  discount: z.number().min(0).optional(),
  discountType: discountTypeEnum.optional(),
  tax: z.number().min(0).max(100).optional(), // Percentage
  serviceCharge: z.number().min(0).max(100).optional(), // Percentage
})

export const updatePaymentSchema = z.object({
  method: paymentMethodEnum.optional(),
  status: paymentStatusEnum.optional(),
})

export const processRefundSchema = z.object({
  reason: z.string().max(500).optional(),
})

export const paymentIdParamSchema = z.object({
  id: z.uuid('Invalid payment ID'),
})

export const orderIdParamSchema = z.object({
  id: z.string().uuid('Invalid order ID'),
})

export const paymentQuerySchema = z.object({
  status: paymentStatusEnum.optional(),
  method: paymentMethodEnum.optional(),
  orderId: z.uuid().optional(),
})

// ===== Routes =====

// GET routes - accessible by all authenticated users
router.get('/', validateQuery(paymentQuerySchema), getAllPayments)
router.get('/:id', validateParams(paymentIdParamSchema), getPaymentById)

// Update payment - admin only
router.put(
  '/:id',
  adminMiddleware,
  validateParams(paymentIdParamSchema),
  validateBody(updatePaymentSchema),
  updatePayment,
)

// Refund - admin only
router.post(
  '/:id/refund',
  adminMiddleware,
  validateParams(paymentIdParamSchema),
  validateBody(processRefundSchema),
  processRefund,
)

// ===== Types =====

export type CreatePaymentBody = z.infer<typeof createPaymentSchema>
export type UpdatePaymentBody = z.infer<typeof updatePaymentSchema>
export type ProcessRefundBody = z.infer<typeof processRefundSchema>
export type PaymentIdParam = z.infer<typeof paymentIdParamSchema>
export type OrderIdParam = z.infer<typeof orderIdParamSchema>
export type PaymentQueryParams = z.infer<typeof paymentQuerySchema>

export default router
