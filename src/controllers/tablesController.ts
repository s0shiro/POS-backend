import type { NextFunction, Response } from 'express'
import { eq } from 'drizzle-orm'
import db from '../db/connection.ts'
import { tables } from '../db/schema/tables.ts'
import { APIError } from '../middleware/errorHandler.ts'
import type { AuthenticatedRequest } from '../middleware/requireAuth.ts'
import type {
  CreateTableBody,
  TableIdParam,
  TableQueryParams,
  UpdateTableBody,
  UpdateTableStatusBody,
} from '../routes/tablesRoutes.ts'

// GET /api/tables
export const getAllTables = async (
  req: AuthenticatedRequest<object, object, TableQueryParams>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { status } = req.query

    const result = await db.query.tables.findMany({
      where: status ? eq(tables.status, status) : undefined,
      orderBy: tables.number,
    })

    res.json({ success: true, data: result })
  } catch (error) {
    next(error)
  }
}

// GET /api/tables/:id
export const getTableById = async (
  req: AuthenticatedRequest<TableIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const table = await db.query.tables.findFirst({
      where: eq(tables.id, id),
    })

    if (!table) {
      throw new APIError('Table not found', 'NOT_FOUND', 404)
    }

    res.json({ success: true, data: table })
  } catch (error) {
    next(error)
  }
}

// POST /api/tables
export const createTable = async (
  req: AuthenticatedRequest<object, CreateTableBody>,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Check if table number already exists
    const [existing] = await db
      .select({ id: tables.id })
      .from(tables)
      .where(eq(tables.number, req.body.number))

    if (existing) {
      throw new APIError('Table number already exists', 'CONFLICT', 409)
    }

    const [table] = await db.insert(tables).values(req.body).returning()

    res.status(201).json({ success: true, data: table })
  } catch (error) {
    next(error)
  }
}

// PUT /api/tables/:id
export const updateTable = async (
  req: AuthenticatedRequest<TableIdParam, Partial<UpdateTableBody>>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const data = req.body

    const [existing] = await db
      .select({ id: tables.id })
      .from(tables)
      .where(eq(tables.id, id))

    if (!existing) {
      throw new APIError('Table not found', 'NOT_FOUND', 404)
    }

    // If updating table number, check for duplicates
    if (data.number) {
      const [duplicate] = await db
        .select({ id: tables.id })
        .from(tables)
        .where(eq(tables.number, data.number))

      if (duplicate && duplicate.id !== id) {
        throw new APIError('Table number already exists', 'CONFLICT', 409)
      }
    }

    const [updated] = await db
      .update(tables)
      .set(data)
      .where(eq(tables.id, id))
      .returning()

    res.json({ success: true, data: updated })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/tables/:id
export const deleteTable = async (
  req: AuthenticatedRequest<TableIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const [existing] = await db
      .select({ id: tables.id })
      .from(tables)
      .where(eq(tables.id, id))

    if (!existing) {
      throw new APIError('Table not found', 'NOT_FOUND', 404)
    }

    await db.delete(tables).where(eq(tables.id, id))

    res.json({ success: true, message: 'Table deleted successfully' })
  } catch (error) {
    next(error)
  }
}

// PATCH /api/tables/:id/status
export const updateTableStatus = async (
  req: AuthenticatedRequest<TableIdParam, UpdateTableStatusBody>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const { status } = req.body

    const [existing] = await db
      .select({ id: tables.id })
      .from(tables)
      .where(eq(tables.id, id))

    if (!existing) {
      throw new APIError('Table not found', 'NOT_FOUND', 404)
    }

    const [updated] = await db
      .update(tables)
      .set({ status })
      .where(eq(tables.id, id))
      .returning()

    res.json({ success: true, data: updated })
  } catch (error) {
    next(error)
  }
}
