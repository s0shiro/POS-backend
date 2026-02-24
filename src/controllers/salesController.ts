import type { NextFunction, Response } from 'express'
import { and, eq, sql, sum, count, desc } from 'drizzle-orm'
import db from '../db/connection.ts'
import { orders, orderItems, payments } from '../db/schema/orders.ts'
import { menuItems } from '../db/schema/menu.ts'
import { user } from '../db/schema/auth.ts'
import { APIError } from '../middleware/errorHandler.ts'
import { emitPrintReceipt, type PrintReceiptData } from '../lib/socket.ts'
import type { AuthenticatedRequest } from '../middleware/requireAuth.ts'

// GET /api/sales/summary?date=YYYY-MM-DD
export const getDailySalesSummary = async (
  req: AuthenticatedRequest<object, object, { date?: string }>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().split('T')[0]
    const dateFilter = sql`${payments.createdAt}::date = ${dateStr}`

    // Per-cashier summary
    const cashierSummary = await db
      .select({
        cashierId: orders.userId,
        cashierName: user.name,
        totalSales: sum(payments.amount).mapWith(Number),
        totalOrders: count(payments.id),
      })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .innerJoin(user, eq(orders.userId, user.id))
      .where(and(eq(payments.status, 'paid'), dateFilter))
      .groupBy(orders.userId, user.name)

    // Day totals
    const [dayTotals] = await db
      .select({
        totalSales: sum(payments.amount).mapWith(Number),
        totalOrders: count(payments.id),
      })
      .from(payments)
      .where(and(eq(payments.status, 'paid'), dateFilter))

    res.json({
      success: true,
      data: {
        date: dateStr,
        totalSales: dayTotals?.totalSales ?? 0,
        totalOrders: dayTotals?.totalOrders ?? 0,
        cashiers: cashierSummary,
      },
    })
  } catch (error) {
    next(error)
  }
}

// GET /api/sales/transactions?date=YYYY-MM-DD&cashierId=xxx
export const getSalesTransactions = async (
  req: AuthenticatedRequest<
    object,
    object,
    { date?: string; cashierId?: string }
  >,
  res: Response,
  next: NextFunction,
) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().split('T')[0]
    const { cashierId } = req.query

    const conditions = [
      eq(payments.status, 'paid'),
      sql`${payments.createdAt}::date = ${dateStr}`,
    ]

    if (cashierId) {
      conditions.push(eq(orders.userId, cashierId) as any)
    }

    const transactions = await db
      .select({
        paymentId: payments.id,
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        tableNumber: orders.tableNumber,
        amount: payments.amount,
        method: payments.method,
        discount: payments.discount,
        discountType: payments.discountType,
        tax: payments.tax,
        serviceCharge: payments.serviceCharge,
        paidAt: payments.createdAt,
        cashierId: orders.userId,
        cashierName: user.name,
      })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .innerJoin(user, eq(orders.userId, user.id))
      .where(and(...conditions))
      .orderBy(desc(payments.createdAt))

    res.json({ success: true, data: transactions })
  } catch (error) {
    next(error)
  }
}

// POST /api/sales/reprint/:orderId
export const reprintReceipt = async (
  req: AuthenticatedRequest<{ orderId: string }>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { orderId } = req.params

    // Fetch order with items, payment, and cashier
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      with: {
        items: {
          with: {
            menuItem: true,
          },
        },
        payment: true,
        createdBy: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (!order) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    if (!order.payment || order.payment.status !== 'paid') {
      throw new APIError(
        'No paid payment found for this order',
        'NOT_FOUND',
        404,
      )
    }

    const payment = order.payment

    const printData: PrintReceiptData = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      items: order.items.map((item) => ({
        name: item.menuItem.name,
        quantity: item.quantity,
        price: parseFloat(item.priceAtTime),
        modifiers:
          (item.selectedModifiers as {
            id: string
            name: string
            price: number
          }[]) ?? [],
      })),
      subtotal: parseFloat(order.totalAmount),
      tax: payment.tax ? parseFloat(payment.tax) : 0,
      total: parseFloat(payment.amount),
      paymentMethod: payment.method,
      amountPaid: payment.receivedAmount
        ? parseFloat(payment.receivedAmount)
        : parseFloat(payment.amount),
      change: payment.change ? parseFloat(payment.change) : 0,
      tableNumber: order.tableNumber,
      cashier: order.createdBy?.name ?? 'Unknown',
      createdAt: order.createdAt!,
    }

    emitPrintReceipt(printData)

    res.json({
      success: true,
      message: `Receipt reprint sent for order ${order.orderNumber}`,
    })
  } catch (error) {
    next(error)
  }
}
