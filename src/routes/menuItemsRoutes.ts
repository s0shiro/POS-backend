import { Router } from 'express'
import {
  createMenuItem,
  createModifier,
  deleteMenuItem,
  deleteModifier,
  getAllMenuItems,
  getMenuItemById,
  updateMenuItem,
} from '../controllers/menuItemsController.ts'
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

export const createMenuItemSchema = z.object({
  categoryId: z.string().uuid('Invalid category ID'),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid price format'),
  image: z.string().url().optional(),
  isAvailable: z.boolean().optional().default(true),
})

export const updateMenuItemSchema = createMenuItemSchema.partial()

export const menuItemIdParamSchema = z.object({
  id: z.string().uuid('Invalid menu item ID'),
})

export const modifierIdParamSchema = z.object({
  id: z.uuid('Invalid menu item ID'),
  modifierId: z.uuid('Invalid modifier ID'),
})

export const menuItemQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  isAvailable: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
})

export const createModifierSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  priceAdjustment: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Invalid price format')
    .optional()
    .default('0.00'),
  isRequired: z.boolean().optional().default(false),
})

// ===== Routes =====

// GET routes - accessible by all authenticated users
router.get('/', validateQuery(menuItemQuerySchema), getAllMenuItems)
router.get('/:id', validateParams(menuItemIdParamSchema), getMenuItemById)

// CUD routes - admin only
router.post(
  '/',
  adminMiddleware,
  validateBody(createMenuItemSchema),
  createMenuItem,
)
router.put(
  '/:id',
  adminMiddleware,
  validateParams(menuItemIdParamSchema),
  validateBody(updateMenuItemSchema),
  updateMenuItem,
)
router.delete(
  '/:id',
  adminMiddleware,
  validateParams(menuItemIdParamSchema),
  deleteMenuItem,
)

// Modifier routes - admin only
router.post(
  '/:id/modifiers',
  adminMiddleware,
  validateParams(menuItemIdParamSchema),
  validateBody(createModifierSchema),
  createModifier,
)
router.delete(
  '/:id/modifiers/:modifierId',
  adminMiddleware,
  validateParams(modifierIdParamSchema),
  deleteModifier,
)

// ===== Types =====

export type CreateMenuItemBody = z.infer<typeof createMenuItemSchema>
export type UpdateMenuItemBody = z.infer<typeof updateMenuItemSchema>
export type MenuItemIdParam = z.infer<typeof menuItemIdParamSchema>
export type ModifierIdParam = z.infer<typeof modifierIdParamSchema>
export type MenuItemQueryParams = z.infer<typeof menuItemQuerySchema>
export type CreateModifierBody = z.infer<typeof createModifierSchema>

export default router
