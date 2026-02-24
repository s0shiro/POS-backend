import type { NextFunction, Response } from 'express'
import { and, eq } from 'drizzle-orm'
import db from '../db/connection.ts'
import { orders, payments } from '../db/schema/orders.ts'
import { tables } from '../db/schema/tables.ts'
import { APIError } from '../middleware/errorHandler.ts'
import type { AuthenticatedRequest } from '../middleware/requireAuth.ts'
import type {
  CreatePaymentBody,
  OrderIdParam,
  PaymentIdParam,
  PaymentQueryParams,
  ProcessRefundBody,
  UpdatePaymentBody,
} from '../routes/paymentsRoutes.ts'
import {
  emitNewOrder,
  emitPrintKitchen,
  emitPrintReceipt,
  type KDSOrder,
  type PrintKitchenData,
  type PrintReceiptData,
} from '../lib/socket.ts'

// GET /api/payments
export const getAllPayments = async (
  req: AuthenticatedRequest<object, object, PaymentQueryParams>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { status, method, orderId } = req.query

    const result = await db.query.payments.findMany({
      where: and(
        status ? eq(payments.status, status) : undefined,
        method ? eq(payments.method, method) : undefined,
        orderId ? eq(payments.orderId, orderId) : undefined,
      ),
      with: {
        order: {
          with: {
            table: true,
            items: {
              with: {
                menuItem: true,
              },
            },
          },
        },
      },
      orderBy: (payments, { desc }) => [desc(payments.createdAt)],
    })

    res.json({ success: true, data: result })
  } catch (error) {
    next(error)
  }
}

// GET /api/payments/:id
export const getPaymentById = async (
  req: AuthenticatedRequest<PaymentIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const payment = await db.query.payments.findFirst({
      where: eq(payments.id, id),
      with: {
        order: {
          with: {
            table: true,
            createdBy: {
              columns: {
                id: true,
                name: true,
                email: true,
              },
            },
            items: {
              with: {
                menuItem: true,
              },
            },
          },
        },
      },
    })

    if (!payment) {
      throw new APIError('Payment not found', 'NOT_FOUND', 404)
    }

    res.json({ success: true, data: payment })
  } catch (error) {
    next(error)
  }
}

// POST /api/orders/:id/payment
export const createPayment = async (
  req: AuthenticatedRequest<OrderIdParam, CreatePaymentBody>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id: orderId } = req.params
    const {
      method,
      receivedAmount,
      discount,
      discountType,
      tax,
      serviceCharge,
    } = req.body

    // Verify order exists
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: {
        id: true,
        status: true,
        totalAmount: true,
        tableId: true,
        isPaid: true,
      },
    })

    if (!order) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    // Check if order already has payment (isPaid flag)
    if (order.isPaid) {
      throw new APIError('Order is already paid', 'CONFLICT', 409)
    }

    // Check if order already has payment record
    const existingPayment = await db.query.payments.findFirst({
      where: eq(payments.orderId, orderId),
    })

    if (existingPayment) {
      throw new APIError('Order already has a payment', 'CONFLICT', 409)
    }

    // Only allow payment for pending orders (McDonald's model: pay before kitchen sees it)
    if (order.status !== 'pending') {
      throw new APIError(
        'Cannot create payment for order that is not pending',
        'CONFLICT',
        409,
      )
    }

    // Calculate final amount
    let finalAmount = parseFloat(order.totalAmount!)

    // Apply discount
    if (discount && discount > 0) {
      if (discountType === 'percentage') {
        finalAmount -= finalAmount * (discount / 100)
      } else {
        finalAmount -= discount
      }
    }

    // Apply tax
    if (tax && tax > 0) {
      finalAmount += finalAmount * (tax / 100)
    }

    // Apply service charge
    if (serviceCharge && serviceCharge > 0) {
      finalAmount += finalAmount * (serviceCharge / 100)
    }

    // Ensure amount is not negative
    finalAmount = Math.max(0, Math.round(finalAmount * 100) / 100)

    // Calculate change for cash payments
    let change = 0
    if (method === 'cash') {
      if (receivedAmount === undefined) {
        throw new APIError(
          'Received amount is required for cash payments',
          'VALIDATION_ERROR',
          400,
        )
      }
      if (receivedAmount < finalAmount) {
        throw new APIError(
          `Insufficient amount. Required: ₱${finalAmount.toFixed(2)}, Received: ₱${receivedAmount.toFixed(2)}`,
          'VALIDATION_ERROR',
          400,
        )
      }
      change = Math.round((receivedAmount - finalAmount) * 100) / 100
    }

    // Create payment and mark order as paid (NOT completed - kitchen still needs to prepare)
    const [payment] = await db.transaction(async (tx) => {
      const [newPayment] = await tx
        .insert(payments)
        .values({
          orderId,
          method,
          amount: finalAmount.toFixed(2),
          status: 'paid',
          discount: discount?.toFixed(2) ?? null,
          discountType: discountType ?? null,
          tax: tax?.toFixed(2) ?? null,
          serviceCharge: serviceCharge?.toFixed(2) ?? null,
          receivedAmount: receivedAmount?.toFixed(2) ?? null,
          change: change.toFixed(2),
        })
        .returning()

      // Mark order as paid - NOW kitchen will see it!
      // Order stays as 'pending' status so kitchen can process it
      await tx
        .update(orders)
        .set({ isPaid: true })
        .where(eq(orders.id, orderId))

      return [newPayment]
    })

    // Fetch complete payment with relations
    const completePayment = await db.query.payments.findFirst({
      where: eq(payments.id, payment.id),
      with: {
        order: {
          with: {
            table: true,
            items: {
              with: {
                menuItem: true,
              },
            },
          },
        },
      },
    })

    // Emit WebSocket event to kitchen - new order to prepare!
    if (completePayment?.order) {
      const kdsOrder: KDSOrder = {
        id: completePayment.order.id,
        orderNumber: completePayment.order.orderNumber!,
        tableNumber: completePayment.order.tableNumber,
        type: completePayment.order.type!,
        status: completePayment.order.status!,
        notes: completePayment.order.notes,
        createdAt: completePayment.order.createdAt!,
        items: completePayment.order.items.map((item) => ({
          id: item.id,
          name: item.menuItem.name,
          quantity: item.quantity,
          notes: item.notes,
          modifiers:
            (item.selectedModifiers as { name: string; price: number }[]) ?? [],
        })),
      }
      emitNewOrder(kdsOrder)

      // Emit print receipt event
      const printData: PrintReceiptData = {
        orderId: completePayment.order.id,
        orderNumber: completePayment.order.orderNumber!,
        items: completePayment.order.items.map((item) => ({
          name: item.menuItem.name,
          quantity: item.quantity,
          price: parseFloat(item.priceAtTime), // Use priceAtTime (includes modifiers)
          modifiers:
            (item.selectedModifiers as {
              id: string
              name: string
              price: number
            }[]) ?? [],
        })),
        subtotal: parseFloat(order.totalAmount!),
        tax: tax ?? 0,
        total: finalAmount,
        paymentMethod: method,
        amountPaid: receivedAmount ?? finalAmount,
        change: change,
        tableNumber: completePayment.order.tableNumber,
        cashier: req.user?.name ?? 'Unknown',
        createdAt: completePayment.order.createdAt!,
      }
      emitPrintReceipt(printData)

      // Emit print kitchen ticket event
      const kitchenPrintData: PrintKitchenData = {
        orderId: completePayment.order.id,
        orderNumber: completePayment.order.orderNumber!,
        tableNumber: completePayment.order.tableNumber,
        type: completePayment.order.type!,
        items: completePayment.order.items.map((item) => ({
          name: item.menuItem.name,
          quantity: item.quantity,
          notes: item.notes,
          modifiers:
            (item.selectedModifiers as { name: string; price: number }[]) ?? [],
        })),
        notes: completePayment.order.notes,
        createdAt: completePayment.order.createdAt!,
      }
      emitPrintKitchen(kitchenPrintData)
    }

    res.status(201).json({
      success: true,
      data: {
        ...completePayment,
        breakdown: {
          subtotal: order.totalAmount,
          discount: discount ?? 0,
          discountType: discountType ?? null,
          tax: tax ?? 0,
          serviceCharge: serviceCharge ?? 0,
          total: finalAmount.toFixed(2),
          receivedAmount: receivedAmount ?? finalAmount,
          change,
        },
      },
    })
  } catch (error) {
    next(error)
  }
}

// PUT /api/payments/:id
export const updatePayment = async (
  req: AuthenticatedRequest<PaymentIdParam, Partial<UpdatePaymentBody>>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const data = req.body

    const [existing] = await db
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(eq(payments.id, id))

    if (!existing) {
      throw new APIError('Payment not found', 'NOT_FOUND', 404)
    }

    // Don't allow updates on refunded payments
    if (existing.status === 'refunded') {
      throw new APIError('Cannot update refunded payment', 'CONFLICT', 409)
    }

    const [updated] = await db
      .update(payments)
      .set(data)
      .where(eq(payments.id, id))
      .returning()

    res.json({ success: true, data: updated })
  } catch (error) {
    next(error)
  }
}

// POST /api/payments/:id/refund
export const processRefund = async (
  req: AuthenticatedRequest<PaymentIdParam, ProcessRefundBody>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const { reason } = req.body

    const payment = await db.query.payments.findFirst({
      where: eq(payments.id, id),
      with: {
        order: {
          columns: { id: true, tableId: true },
        },
      },
    })

    if (!payment) {
      throw new APIError('Payment not found', 'NOT_FOUND', 404)
    }

    if (payment.status === 'refunded') {
      throw new APIError('Payment already refunded', 'CONFLICT', 409)
    }

    if (payment.status !== 'paid') {
      throw new APIError('Can only refund paid payments', 'CONFLICT', 409)
    }

    await db.transaction(async (tx) => {
      // Update payment status
      await tx
        .update(payments)
        .set({ status: 'refunded' })
        .where(eq(payments.id, id))

      // Update order status to canceled
      await tx
        .update(orders)
        .set({ status: 'canceled' })
        .where(eq(orders.id, payment.orderId))

      // Free up table if applicable
      if (payment.order?.tableId) {
        await tx
          .update(tables)
          .set({ status: 'available' })
          .where(eq(tables.id, payment.order.tableId))
      }
    })

    const updated = await db.query.payments.findFirst({
      where: eq(payments.id, id),
      with: {
        order: {
          with: {
            table: true,
            items: {
              with: {
                menuItem: true,
              },
            },
          },
        },
      },
    })

    res.json({
      success: true,
      data: updated,
      refund: {
        reason: reason ?? null,
        refundedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    next(error)
  }
}
