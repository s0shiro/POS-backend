import { Router } from 'express'
import {
  createCategory,
  deleteCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
} from '../controllers/categoriesController.ts'
import { adminMiddleware } from '../middleware/admin.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import { validateBody, validateParams } from '../middleware/validation.ts'
import z from 'zod'

const router = Router()

router.use(requireAuth)

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
})

export const updateCategorySchema = createCategorySchema.partial()

export const categoryIdParamSchema = z.object({
  id: z.uuid('Invalid category ID'),
})

// GET routes - accessible by all authenticated users
router.get('/', getAllCategories)
router.get('/:id', validateParams(categoryIdParamSchema), getCategoryById)

// CUD routes - admin only
router.post(
  '/',
  adminMiddleware,
  validateBody(createCategorySchema),
  createCategory,
)
router.put(
  '/:id',
  adminMiddleware,
  validateParams(categoryIdParamSchema),
  validateBody(updateCategorySchema),
  updateCategory,
)
router.delete(
  '/:id',
  adminMiddleware,
  validateParams(categoryIdParamSchema),
  deleteCategory,
)

export type CreateCategoryBody = z.infer<typeof createCategorySchema>
export type UpdateCategoryBody = z.infer<typeof updateCategorySchema>
export type CategoryIdParam = z.infer<typeof categoryIdParamSchema>

export default router
