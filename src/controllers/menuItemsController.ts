import type { NextFunction, Response } from 'express'
import { and, eq } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import db from '../db/connection.ts'
import { menuCategories, menuItems, modifiers } from '../db/schema/menu.ts'
import { orderItems } from '../db/schema/orders.ts'
import { APIError } from '../middleware/errorHandler.ts'
import type { AuthenticatedRequest } from '../middleware/requireAuth.ts'
import {
  createMenuItemSchema,
  updateMenuItemSchema,
  type CreateModifierBody,
  type MenuItemIdParam,
  type MenuItemQueryParams,
  type ModifierIdParam,
} from '../routes/menuItemsRoutes.ts'

// GET /api/menu/items
export const getAllMenuItems = async (
  req: AuthenticatedRequest<object, object, MenuItemQueryParams>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { categoryId, isAvailable } = req.query

    const items = await db.query.menuItems.findMany({
      where: and(
        categoryId ? eq(menuItems.categoryId, categoryId) : undefined,
        isAvailable !== undefined
          ? eq(menuItems.isAvailable, isAvailable)
          : undefined,
      ),
      with: {
        category: true,
        modifiers: true,
      },
    })

    res.json({ success: true, data: items })
  } catch (error) {
    next(error)
  }
}

// GET /api/menu/items/:id
export const getMenuItemById = async (
  req: AuthenticatedRequest<MenuItemIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const item = await db.query.menuItems.findFirst({
      where: eq(menuItems.id, id),
      with: {
        category: true,
        modifiers: true,
      },
    })

    if (!item) {
      throw new APIError('Menu item not found', 'NOT_FOUND', 404)
    }

    res.json({ success: true, data: item })
  } catch (error) {
    next(error)
  }
}

// POST /api/menu/items
export const createMenuItem = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const parsed = createMenuItemSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new APIError(
        parsed.error.issues[0].message,
        'VALIDATION_ERROR',
        400,
      )
    }
    const body = parsed.data
    const { categoryId } = body

    // Verify category exists
    const [category] = await db
      .select({ id: menuCategories.id })
      .from(menuCategories)
      .where(eq(menuCategories.id, categoryId))

    if (!category) {
      throw new APIError('Category not found', 'NOT_FOUND', 404)
    }

    // Handle uploaded image
    const file = req.file as Express.Multer.File | undefined
    const image = file ? `/uploads/${file.filename}` : body.image || null

    const [item] = await db
      .insert(menuItems)
      .values({
        categoryId: body.categoryId,
        name: body.name,
        description: body.description,
        price: body.price,
        image,
        isAvailable: body.isAvailable,
      })
      .returning()

    res.status(201).json({ success: true, data: item })
  } catch (error) {
    next(error)
  }
}

// PUT /api/menu/items/:id
export const updateMenuItem = async (
  req: AuthenticatedRequest<MenuItemIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const parsed = updateMenuItemSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new APIError(
        parsed.error.issues[0].message,
        'VALIDATION_ERROR',
        400,
      )
    }
    const data = parsed.data

    // Verify item exists
    const [existing] = await db
      .select({ id: menuItems.id, image: menuItems.image })
      .from(menuItems)
      .where(eq(menuItems.id, id))

    if (!existing) {
      throw new APIError('Menu item not found', 'NOT_FOUND', 404)
    }

    // If updating categoryId, verify new category exists
    if (data.categoryId) {
      const [category] = await db
        .select({ id: menuCategories.id })
        .from(menuCategories)
        .where(eq(menuCategories.id, data.categoryId))

      if (!category) {
        throw new APIError('Category not found', 'NOT_FOUND', 404)
      }
    }

    // Handle uploaded image
    const file = req.file as Express.Multer.File | undefined
    let image: string | null | undefined = data.image
    if (file) {
      image = `/uploads/${file.filename}`
      // Delete old image file if it was a local upload
      if (existing.image && existing.image.startsWith('/uploads/')) {
        const oldPath = path.join(process.cwd(), existing.image)
        fs.unlink(oldPath, () => {}) // fire and forget
      }
    }

    const [updated] = await db
      .update(menuItems)
      .set({ ...data, image: image !== undefined ? image : undefined })
      .where(eq(menuItems.id, id))
      .returning()

    res.json({ success: true, data: updated })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/menu/items/:id
export const deleteMenuItem = async (
  req: AuthenticatedRequest<MenuItemIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const [existing] = await db
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(eq(menuItems.id, id))

    if (!existing) {
      throw new APIError('Menu item not found', 'NOT_FOUND', 404)
    }

    // Check if menu item is used in any orders
    const [usedInOrder] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.menuItemId, id))
      .limit(1)

    if (usedInOrder) {
      // Instead of deleting, mark as unavailable to preserve order history
      await db
        .update(menuItems)
        .set({ isAvailable: false })
        .where(eq(menuItems.id, id))

      res.json({
        success: true,
        message:
          'Menu item has been marked as unavailable because it is referenced in existing orders. It will no longer appear in the menu.',
        archived: true,
      })
      return
    }

    // Delete related modifiers first
    await db.delete(modifiers).where(eq(modifiers.menuItemId, id))
    await db.delete(menuItems).where(eq(menuItems.id, id))

    res.json({ success: true, message: 'Menu item deleted successfully' })
  } catch (error) {
    next(error)
  }
}

// POST /api/menu/items/:id/modifiers
export const createModifier = async (
  req: AuthenticatedRequest<MenuItemIdParam, CreateModifierBody>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id: menuItemId } = req.params

    // Verify menu item exists
    const [item] = await db
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(eq(menuItems.id, menuItemId))

    if (!item) {
      throw new APIError('Menu item not found', 'NOT_FOUND', 404)
    }

    const [modifier] = await db
      .insert(modifiers)
      .values({ ...req.body, menuItemId })
      .returning()

    res.status(201).json({ success: true, data: modifier })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/menu/items/:id/modifiers/:modifierId
export const deleteModifier = async (
  req: AuthenticatedRequest<MenuItemIdParam & ModifierIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id: menuItemId, modifierId } = req.params

    const [existing] = await db
      .select({ id: modifiers.id })
      .from(modifiers)
      .where(
        and(eq(modifiers.id, modifierId), eq(modifiers.menuItemId, menuItemId)),
      )

    if (!existing) {
      throw new APIError('Modifier not found', 'NOT_FOUND', 404)
    }

    await db.delete(modifiers).where(eq(modifiers.id, modifierId))

    res.json({ success: true, message: 'Modifier deleted successfully' })
  } catch (error) {
    next(error)
  }
}
