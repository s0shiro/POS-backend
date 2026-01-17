import { Router } from 'express'
import {
  createTable,
  deleteTable,
  getAllTables,
  getTableById,
  updateTable,
  updateTableStatus,
} from '../controllers/tablesController.ts'
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

const tableStatusEnum = z.enum(['available', 'occupied', 'reserved'])

export const createTableSchema = z.object({
  number: z.string().min(1, 'Table number is required').max(10),
  capacity: z.number().int().min(1, 'Capacity must be at least 1').max(50),
  status: tableStatusEnum.optional().default('available'),
})

export const updateTableSchema = createTableSchema.partial()

export const updateTableStatusSchema = z.object({
  status: tableStatusEnum,
})

export const tableIdParamSchema = z.object({
  id: z.string().uuid('Invalid table ID'),
})

export const tableQuerySchema = z.object({
  status: tableStatusEnum.optional(),
})

// ===== Routes =====

// GET routes - accessible by all authenticated users
router.get('/', validateQuery(tableQuerySchema), getAllTables)
router.get('/:id', validateParams(tableIdParamSchema), getTableById)

// CUD routes - admin only
router.post('/', adminMiddleware, validateBody(createTableSchema), createTable)
router.put(
  '/:id',
  adminMiddleware,
  validateParams(tableIdParamSchema),
  validateBody(updateTableSchema),
  updateTable,
)
router.delete(
  '/:id',
  adminMiddleware,
  validateParams(tableIdParamSchema),
  deleteTable,
)

// Status update - accessible by cashier (all authenticated users)
router.patch(
  '/:id/status',
  validateParams(tableIdParamSchema),
  validateBody(updateTableStatusSchema),
  updateTableStatus,
)

// ===== Types =====

export type CreateTableBody = z.infer<typeof createTableSchema>
export type UpdateTableBody = z.infer<typeof updateTableSchema>
export type UpdateTableStatusBody = z.infer<typeof updateTableStatusSchema>
export type TableIdParam = z.infer<typeof tableIdParamSchema>
export type TableQueryParams = z.infer<typeof tableQuerySchema>

export default router
