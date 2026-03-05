import type { NextFunction, Response } from 'express'
import { and, eq, inArray } from 'drizzle-orm'
import db from '../db/connection.ts'
import { menuItems, modifiers } from '../db/schema/menu.ts'
import { orderItems, orders } from '../db/schema/orders.ts'
import { APIError } from '../middleware/errorHandler.ts'
import type { AuthenticatedRequest } from '../middleware/requireAuth.ts'
import type {
  AddOrderItemBody,
  CreateOrderBody,
  OrderIdParam,
  OrderItemIdParam,
  OrderQueryParams,
  SelectedModifier,
  UpdateOrderBody,
  UpdateOrderStatusBody,
} from '../routes/ordersRoutes.ts'

// GET /api/orders
export const getAllOrders = async (
  req: AuthenticatedRequest<object, object, OrderQueryParams>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { status, type, tableNumber, isPaid } = req.query

    const result = await db.query.orders.findMany({
      columns: { tableId: false },
      where: and(
        status ? eq(orders.status, status) : undefined,
        type ? eq(orders.type, type) : undefined,
        tableNumber ? eq(orders.tableNumber, tableNumber) : undefined,
        isPaid !== undefined ? eq(orders.isPaid, isPaid) : undefined,
      ),
      with: {
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
        payment: true,
      },
      orderBy: (orders, { desc }) => [desc(orders.createdAt)],
    })

    res.json({ success: true, data: result })
  } catch (error) {
    next(error)
  }
}

// GET /api/orders/:id
export const getOrderById = async (
  req: AuthenticatedRequest<OrderIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const order = await db.query.orders.findFirst({
      columns: { tableId: false },
      where: eq(orders.id, id),
      with: {
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
        payment: true,
      },
    })

    if (!order) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    res.json({ success: true, data: order })
  } catch (error) {
    next(error)
  }
}

// Helper to generate order number
function generateOrderNumber(): string {
  // Generate random 4-digit number (0001-9999)
  const num = Math.floor(Math.random() * 9999) + 1
  return `#${num.toString().padStart(4, '0')}`
}

// POST /api/orders
export const createOrder = async (
  req: AuthenticatedRequest<object, CreateOrderBody>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { tableNumber, type, items, notes } = req.body
    const userId = req.user.id

    // For dine-in orders, tableNumber (string) is required
    if (type === 'dine_in' && !tableNumber) {
      throw new APIError(
        'Table number is required for dine-in orders',
        'VALIDATION_ERROR',
        400,
      )
    }

    // Validate and fetch menu items
    const menuItemIds = items.map((item) => item.menuItemId)
    const fetchedMenuItems = await db
      .select()
      .from(menuItems)
      .where(
        and(
          eq(menuItems.isAvailable, true),
          inArray(menuItems.id, menuItemIds),
        ),
      )

    const menuItemsMap = new Map(
      fetchedMenuItems.map((item) => [item.id, item]),
    )

    // Validate all items exist and are available
    for (const item of items) {
      const menuItem = menuItemsMap.get(item.menuItemId)
      if (!menuItem) {
        throw new APIError(
          `Menu item ${item.menuItemId} not found or unavailable`,
          'NOT_FOUND',
          404,
        )
      }
    }

    // Collect all modifier IDs from the request
    const allModifierIds: string[] = []
    for (const item of items) {
      const itemModifiers = item.selectedModifiers as
        | SelectedModifier[]
        | undefined
      if (itemModifiers && itemModifiers.length > 0) {
        for (const mod of itemModifiers) {
          if (mod.id) allModifierIds.push(mod.id)
        }
      }
    }

    // Fetch modifier prices from database
    let modifiersMap = new Map<
      string,
      { id: string; name: string; priceAdjustment: string | null }
    >()
    if (allModifierIds.length > 0) {
      const fetchedModifiers = await db
        .select({
          id: modifiers.id,
          name: modifiers.name,
          priceAdjustment: modifiers.priceAdjustment,
        })
        .from(modifiers)
        .where(inArray(modifiers.id, allModifierIds))

      modifiersMap = new Map(fetchedModifiers.map((mod) => [mod.id, mod]))
    }

    // Calculate total amount
    let totalAmount = 0
    const orderItemsData = items.map((item) => {
      const menuItem = menuItemsMap.get(item.menuItemId)!
      const basePrice = parseFloat(menuItem.price)

      // Calculate modifier prices from database
      let modifierTotal = 0
      const resolvedModifiers: { id: string; name: string; price: number }[] =
        []

      const itemModifiers = item.selectedModifiers as
        | SelectedModifier[]
        | undefined
      if (itemModifiers && itemModifiers.length > 0) {
        for (const mod of itemModifiers) {
          const dbModifier = mod.id ? modifiersMap.get(mod.id) : null
          const price = dbModifier?.priceAdjustment
            ? parseFloat(dbModifier.priceAdjustment)
            : 0
          modifierTotal += price
          resolvedModifiers.push({
            id: mod.id || '',
            name: dbModifier?.name || mod.name || '',
            price,
          })
        }
      }

      const unitPrice = basePrice + modifierTotal
      const itemTotal = unitPrice * item.quantity
      totalAmount += itemTotal

      return {
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        priceAtTime: unitPrice.toFixed(2),
        notes: item.notes ?? null,
        selectedModifiers:
          resolvedModifiers.length > 0 ? resolvedModifiers : null,
      }
    })

    // Create order with items in a transaction
    const [order] = await db.transaction(async (tx) => {
      // Generate unique order number
      const orderNumber = generateOrderNumber()

      // Create order (isPaid: false - kitchen won't see until paid)
      const [newOrder] = await tx
        .insert(orders)
        .values({
          orderNumber,
          tableNumber: tableNumber ?? null,
          userId,
          type,
          totalAmount: totalAmount.toFixed(2),
          status: 'pending',
          isPaid: false,
          notes: notes ?? null,
        })
        .returning()

      // Create order items
      await tx.insert(orderItems).values(
        orderItemsData.map((item) => ({
          ...item,
          orderId: newOrder.id,
        })),
      )

      return [newOrder]
    })

    // Fetch complete order with relations
    const completeOrder = await db.query.orders.findFirst({
      columns: { tableId: false },
      where: eq(orders.id, order.id),
      with: {
        items: {
          with: {
            menuItem: true,
          },
        },
      },
    })

    res.status(201).json({ success: true, data: completeOrder })
  } catch (error) {
    next(error)
  }
}

// PUT /api/orders/:id
export const updateOrder = async (
  req: AuthenticatedRequest<OrderIdParam, Partial<UpdateOrderBody>>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const data = req.body

    const [existing] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, id))

    if (!existing) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    // Only allow updates on pending orders
    if (existing.status !== 'pending') {
      throw new APIError(
        'Cannot update order that is not pending',
        'CONFLICT',
        409,
      )
    }

    const [updated] = await db
      .update(orders)
      .set(data)
      .where(eq(orders.id, id))
      .returning()

    res.json({ success: true, data: updated })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/orders/:id
export const deleteOrder = async (
  req: AuthenticatedRequest<OrderIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: { id: true, status: true },
    })

    if (!order) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    // Only allow deletion of pending or cancelled orders
    if (!['pending', 'cancelled'].includes(order.status!)) {
      throw new APIError(
        'Cannot delete order that is in progress or completed',
        'CONFLICT',
        409,
      )
    }

    await db.transaction(async (tx) => {
      // Delete order items first
      await tx.delete(orderItems).where(eq(orderItems.orderId, id))

      // Delete order
      await tx.delete(orders).where(eq(orders.id, id))
    })

    res.json({ success: true, message: 'Order deleted successfully' })
  } catch (error) {
    next(error)
  }
}

// PATCH /api/orders/:id/status
export const updateOrderStatus = async (
  req: AuthenticatedRequest<OrderIdParam, UpdateOrderStatusBody>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const { status } = req.body

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: { id: true, status: true },
    })

    if (!order) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    // Validate status transitions
    const validTransitions: Record<string, string[]> = {
      pending: ['preparing', 'cancelled'],
      preparing: ['ready', 'cancelled'],
      ready: ['completed'],
      completed: [],
      cancelled: [],
    }

    const currentStatus = order.status!
    if (!validTransitions[currentStatus]?.includes(status)) {
      throw new APIError(
        `Cannot transition from ${currentStatus} to ${status}`,
        'VALIDATION_ERROR',
        400,
      )
    }

    await db.update(orders).set({ status }).where(eq(orders.id, id))

    const updated = await db.query.orders.findFirst({
      columns: { tableId: false },
      where: eq(orders.id, id),
      with: {
        items: {
          with: {
            menuItem: true,
          },
        },
      },
    })

    res.json({ success: true, data: updated })
  } catch (error) {
    next(error)
  }
}

// POST /api/orders/:id/items
export const addOrderItem = async (
  req: AuthenticatedRequest<OrderIdParam, AddOrderItemBody>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id: orderId } = req.params
    const { menuItemId, quantity, notes, selectedModifiers } = req.body

    // Verify order exists and is pending
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: { id: true, status: true, totalAmount: true },
    })

    if (!order) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    if (order.status !== 'pending') {
      throw new APIError(
        'Cannot add items to order that is not pending',
        'CONFLICT',
        409,
      )
    }

    // Verify menu item exists and is available
    const [menuItem] = await db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.id, menuItemId), eq(menuItems.isAvailable, true)))

    if (!menuItem) {
      throw new APIError('Menu item not found or unavailable', 'NOT_FOUND', 404)
    }

    // Fetch modifier prices from database
    const itemModifiers = selectedModifiers as SelectedModifier[] | undefined
    const modifierIds =
      (itemModifiers?.map((mod) => mod.id).filter(Boolean) as string[]) || []
    let modifiersMap = new Map<
      string,
      { id: string; name: string; priceAdjustment: string | null }
    >()

    if (modifierIds.length > 0) {
      const fetchedModifiers = await db
        .select({
          id: modifiers.id,
          name: modifiers.name,
          priceAdjustment: modifiers.priceAdjustment,
        })
        .from(modifiers)
        .where(inArray(modifiers.id, modifierIds))

      modifiersMap = new Map(fetchedModifiers.map((mod) => [mod.id, mod]))
    }

    // Calculate price with modifiers from database
    const basePrice = parseFloat(menuItem.price)
    let modifierTotal = 0
    const resolvedModifiers: { id: string; name: string; price: number }[] = []

    if (itemModifiers && itemModifiers.length > 0) {
      for (const mod of itemModifiers) {
        const dbModifier = mod.id ? modifiersMap.get(mod.id) : null
        const price = dbModifier?.priceAdjustment
          ? parseFloat(dbModifier.priceAdjustment)
          : 0
        modifierTotal += price
        resolvedModifiers.push({
          id: mod.id || '',
          name: dbModifier?.name || mod.name || '',
          price,
        })
      }
    }

    const unitPrice = basePrice + modifierTotal
    const itemTotal = unitPrice * quantity

    // Add item and update total
    await db.transaction(async (tx) => {
      await tx.insert(orderItems).values({
        orderId,
        menuItemId,
        quantity,
        priceAtTime: unitPrice.toFixed(2),
        notes: notes ?? null,
        selectedModifiers:
          resolvedModifiers.length > 0 ? resolvedModifiers : null,
      })

      const newTotal = parseFloat(order.totalAmount!) + itemTotal
      await tx
        .update(orders)
        .set({ totalAmount: newTotal.toFixed(2) })
        .where(eq(orders.id, orderId))
    })

    const updated = await db.query.orders.findFirst({
      columns: { tableId: false },
      where: eq(orders.id, orderId),
      with: {
        items: {
          with: {
            menuItem: true,
          },
        },
      },
    })

    res.status(201).json({ success: true, data: updated })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/orders/:id/items/:itemId
export const removeOrderItem = async (
  req: AuthenticatedRequest<OrderIdParam & OrderItemIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id: orderId, itemId } = req.params

    // Verify order exists and is pending
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: { id: true, status: true, totalAmount: true },
    })

    if (!order) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    if (order.status !== 'pending') {
      throw new APIError(
        'Cannot remove items from order that is not pending',
        'CONFLICT',
        409,
      )
    }

    // Verify order item exists
    const [orderItem] = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))

    if (!orderItem) {
      throw new APIError('Order item not found', 'NOT_FOUND', 404)
    }

    // Calculate amount to subtract
    const itemTotal = parseFloat(orderItem.priceAtTime) * orderItem.quantity

    // Remove item and update total
    await db.transaction(async (tx) => {
      await tx.delete(orderItems).where(eq(orderItems.id, itemId))

      const newTotal = parseFloat(order.totalAmount!) - itemTotal
      await tx
        .update(orders)
        .set({ totalAmount: Math.max(0, newTotal).toFixed(2) })
        .where(eq(orders.id, orderId))
    })

    const updated = await db.query.orders.findFirst({
      columns: { tableId: false },
      where: eq(orders.id, orderId),
      with: {
        items: {
          with: {
            menuItem: true,
          },
        },
      },
    })

    res.json({ success: true, data: updated })
  } catch (error) {
    next(error)
  }
}

// GET /api/orders/:id/receipt
export const generateReceipt = async (
  req: AuthenticatedRequest<OrderIdParam>,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params

    const order = await db.query.orders.findFirst({
      columns: { tableId: false },
      where: eq(orders.id, id),
      with: {
        createdBy: {
          columns: {
            id: true,
            name: true,
          },
        },
        items: {
          with: {
            menuItem: {
              columns: {
                id: true,
                name: true,
              },
            },
          },
        },
        payment: true,
      },
    })

    if (!order) {
      throw new APIError('Order not found', 'NOT_FOUND', 404)
    }

    if (!order.payment) {
      throw new APIError('Order has no payment yet', 'BAD_REQUEST', 400)
    }

    // Build receipt data
    const receipt = {
      // Header
      receiptNumber: `RCP-${order.orderNumber}`,
      orderNumber: order.orderNumber,
      date: order.createdAt,
      type: order.type,
      tableNumber: order.tableNumber ?? null,
      cashier: order.createdBy?.name ?? 'Unknown',

      // Items
      items: order.items.map((item) => ({
        name: item.menuItem.name,
        quantity: item.quantity,
        unitPrice: parseFloat(item.priceAtTime),
        modifiers:
          (item.selectedModifiers as { name: string; price: number }[]) ?? [],
        subtotal: parseFloat(item.priceAtTime) * item.quantity,
      })),

      // Totals
      subtotal: parseFloat(order.totalAmount ?? '0'),
      discount: order.payment.discount ? parseFloat(order.payment.discount) : 0,
      discountType: order.payment.discountType ?? null,
      tax: order.payment.tax ? parseFloat(order.payment.tax) : 0,
      serviceCharge: order.payment.serviceCharge
        ? parseFloat(order.payment.serviceCharge)
        : 0,

      // Payment
      totalAmount: parseFloat(order.payment.amount),
      paymentMethod: order.payment.method,
      receivedAmount: order.payment.receivedAmount
        ? parseFloat(order.payment.receivedAmount)
        : parseFloat(order.payment.amount),
      change: order.payment.change ? parseFloat(order.payment.change) : 0,

      paidAt: order.payment.createdAt,
    }

    res.json({ success: true, data: receipt })
  } catch (error) {
    next(error)
  }
}
