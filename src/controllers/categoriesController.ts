import type { NextFunction, Response } from 'express'
import type { AuthenticatedRequest } from '../middleware/requireAuth.ts'
import db from '../db/connection.ts'
import { menuCategories } from '../db/schema/menu.ts'
import { APIError } from '../middleware/errorHandler.ts'
import { eq } from 'drizzle-orm'
import type {
  CategoryIdParam,
  CreateCategoryBody,
  UpdateCategoryBody,
} from '../routes/categoriesRoutes.ts'

export const getAllCategories = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const categories = await db
      .select()
      .from(menuCategories)
      .orderBy(menuCategories.sortOrder)

    res.json({ success: true, data: categories })
  } catch (error) {
    next(error)
  }
}

export const getCategoryById = async (
  req: AuthenticatedRequest<CategoryIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const [category] = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.id, id))

    if (!category) {
      throw new APIError('Category not found', 'NOT_FOUND', 404)
    }

    res.json({ success: true, data: category })
  } catch (error) {
    next(error)
  }
}

export const createCategory = async (
  req: AuthenticatedRequest<object, CreateCategoryBody>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { name, description, sortOrder, isActive } = req.body

    const [category] = await db
      .insert(menuCategories)
      .values({
        name,
        description: description ?? null,
        sortOrder,
        isActive,
      })
      .returning()

    res.status(201).json({ success: true, data: category })
  } catch (error) {
    next(error)
  }
}

export const updateCategory = async (
  req: AuthenticatedRequest<CategoryIdParam, UpdateCategoryBody>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const data = req.body

    const [existing] = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.id, id))

    if (!existing) {
      throw new APIError('Category not found', 'NOT_FOUND', 404)
    }

    const [updated] = await db
      .update(menuCategories)
      .set({
        name: data.name ?? existing.name,
        description:
          data.description !== undefined
            ? data.description
            : existing.description,
        sortOrder: data.sortOrder ?? existing.sortOrder,
        isActive: data.isActive ?? existing.isActive,
      })
      .where(eq(menuCategories.id, id))
      .returning()

    res.json({ success: true, data: updated })
  } catch (error) {
    next(error)
  }
}

export const deleteCategory = async (
  req: AuthenticatedRequest<CategoryIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const [existing] = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.id, id))

    if (!existing) {
      throw new APIError('Category not found', 'NOT_FOUND', 404)
    }

    await db.delete(menuCategories).where(eq(menuCategories.id, id))

    res.json({ success: true, message: 'Category deleted successfully' })
  } catch (error) {
    next(error)
  }
}
