import { Router } from 'express'
import {
  getDailySalesSummary,
  getSalesTransactions,
  reprintReceipt,
} from '../controllers/salesController.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import { adminMiddleware } from '../middleware/admin.ts'

const router = Router()

// All sales routes require admin
router.use(requireAuth, adminMiddleware)

router.get('/summary', getDailySalesSummary)
router.get('/transactions', getSalesTransactions)
router.post('/reprint/:orderId', reprintReceipt)

export default router
