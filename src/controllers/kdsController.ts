import type { NextFunction, Response } from 'express'
import { and, eq, inArray, count, sql } from 'drizzle-orm'
import db from '../db/connection.ts'
import { orders, orderItems } from '../db/schema/orders.ts'
import { APIError } from '../middleware/errorHandler.ts'
import type { AuthenticatedRequest } from '../middleware/requireAuth.ts'
import type { OrderIdParam } from '../routes/kdsRoutes.ts'
import { emitOrderUpdate, emitOrderReady } from '../lib/socket.ts'

// GET /api/kds/orders
// Returns paid orders that are pending or preparing (what kitchen needs to see)
export const getKitchenOrders = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await db.query.orders.findMany({
      where: and(
        eq(orders.isPaid, true),
        inArray(orders.status, ['pending', 'preparing']),
      ),
      with: {
        items: {
          with: {
            menuItem: {
              columns: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
      },
      orderBy: (orders, { asc }) => [asc(orders.createdAt)], // FIFO - oldest first
    })

    // Format for KDS display
    const kdsOrders = result.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber,
      type: order.type,
      status: order.status,
      notes: order.notes,
      createdAt: order.createdAt,
      // Calculate time elapsed since order was placed
      elapsedMinutes: Math.floor(
        (Date.now() - new Date(order.createdAt!).getTime()) / 60000,
      ),
      items: order.items.map((item) => ({
        id: item.id,
        name: item.menuItem.name,
        quantity: item.quantity,
        notes: item.notes,
        modifiers:
          (item.selectedModifiers as { name: string; price: number }[]) ?? [],
      })),
    }))

    res.json({ success: true, data: kdsOrders })
  } catch (error) {
    next(error)
  }
}

// GET /api/kds/stats
// Returns kitchen statistics (pending count, preparing count, avg time)
export const getKitchenStats = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Count orders by status
    const pendingCount = await db
      .select({ count: count() })
      .from(orders)
      .where(and(eq(orders.isPaid, true), eq(orders.status, 'pending')))

    const preparingCount = await db
      .select({ count: count() })
      .from(orders)
      .where(and(eq(orders.isPaid, true), eq(orders.status, 'preparing')))

    const readyCount = await db
      .select({ count: count() })
      .from(orders)
      .where(eq(orders.status, 'ready'))

    // Count completed orders today
    const completedTodayCount = await db
      .select({ count: count() })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'completed'),
          sql`DATE(${orders.updatedAt}) = CURRENT_DATE`,
        ),
      )

    res.json({
      success: true,
      data: {
        pending: pendingCount[0]?.count ?? 0,
        preparing: preparingCount[0]?.count ?? 0,
        ready: readyCount[0]?.count ?? 0,
        completedToday: completedTodayCount[0]?.count ?? 0,
      },
    })
  } catch (error) {
    next(error)
  }
}

// PATCH /api/kds/orders/:id/preparing
// Kitchen starts preparing an order
export const startPreparing = async (
  req: AuthenticatedRequest<OrderIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: { id: true, status: true, isPaid: true },
    })

    if (!order) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    if (!order.isPaid) {
      throw new APIError('Order is not paid yet', 'BAD_REQUEST', 400)
    }

    if (order.status !== 'pending') {
      throw new APIError(
        `Cannot start preparing order with status: ${order.status}`,
        'BAD_REQUEST',
        400,
      )
    }

    const [updated] = await db
      .update(orders)
      .set({ status: 'preparing' })
      .where(eq(orders.id, id))
      .returning()

    // Emit WebSocket event to kitchen displays
    emitOrderUpdate({
      id: updated.id,
      orderNumber: updated.orderNumber!,
      status: updated.status!,
    })

    res.json({
      success: true,
      data: {
        id: updated.id,
        orderNumber: updated.orderNumber,
        status: updated.status,
        message: 'Order is now being prepared',
      },
    })
  } catch (error) {
    next(error)
  }
}

// PATCH /api/kds/orders/:id/ready
// Kitchen marks order as ready for pickup
export const markReady = async (
  req: AuthenticatedRequest<OrderIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true,
        status: true,
        isPaid: true,
        orderNumber: true,
        tableNumber: true,
        type: true,
      },
    })

    if (!order) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    if (!order.isPaid) {
      throw new APIError('Order is not paid yet', 'BAD_REQUEST', 400)
    }

    if (order.status !== 'preparing') {
      throw new APIError(
        `Cannot mark as ready order with status: ${order.status}`,
        'BAD_REQUEST',
        400,
      )
    }

    const [updated] = await db
      .update(orders)
      .set({ status: 'ready' })
      .where(eq(orders.id, id))
      .returning()

    // Emit to kitchen (order updated/removed from active queue)
    emitOrderUpdate({
      id: updated.id,
      orderNumber: updated.orderNumber!,
      status: updated.status!,
    })

    // Emit to cashier (order ready for pickup notification)
    // This also automatically broadcasts to customer display
    emitOrderReady({
      id: updated.id,
      orderNumber: updated.orderNumber!,
      tableNumber: updated.tableNumber,
      type: order.type!,
    })

    res.json({
      success: true,
      data: {
        id: updated.id,
        orderNumber: updated.orderNumber,
        tableNumber: updated.tableNumber,
        status: updated.status,
        message: `Order ${updated.orderNumber} is ready for pickup!`,
      },
    })
  } catch (error) {
    next(error)
  }
}
