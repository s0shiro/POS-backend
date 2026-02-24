import type { Server as HTTPServer } from 'http'
import { Server, Socket } from 'socket.io'
import db from '../db/connection.ts'
import { user } from '../db/schema/auth.ts'
import { eq } from 'drizzle-orm'

let io: Server | null = null

// In-memory store of currently called/ready orders for the customer display
const calledOrders = new Map<string, OrderCalledNotification>()

// Auto-expire called orders after 5 minutes (same as client-side timeout)
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
  for (const [id, order] of calledOrders) {
    if (new Date(order.calledAt).getTime() < fiveMinutesAgo) {
      calledOrders.delete(id)
    }
  }
}, 30000)

export const initSocket = (httpServer: HTTPServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL ?? '*',
      credentials: true,
    },
  })

  // Authentication middleware using one-time-token
  io.use(async (socket, next) => {
    try {
      // Support token from auth object OR query parameter (for Postman)
      const token = socket.handshake.auth.token || socket.handshake.query.token

      console.log('[Socket] Auth attempt, token:', token ? token : 'missing')

      if (!token) {
        return next(new Error('Authentication required'))
      }

      // Verify one-time token by calling the API endpoint directly
      const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
      const response = await fetch(
        `${baseUrl}/api/auth/one-time-token/verify`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token }),
        },
      )

      console.log('[Socket] Verify response status:', response.status)

      if (!response.ok) {
        const errorText = await response.text()
        console.log('[Socket] Verify error:', errorText)
        return next(new Error('Invalid or expired token'))
      }

      const result = await response.json()
      console.log('[Socket] Verify result:', JSON.stringify(result, null, 2))

      // Get user from result
      const userId =
        result?.userId || result?.user?.id || result?.session?.userId

      if (!userId) {
        console.log('[Socket] No userId in result')
        return next(new Error('Invalid token response'))
      }

      // Fetch full user from database
      const [userData] = await db.select().from(user).where(eq(user.id, userId))

      if (!userData) {
        console.log('[Socket] User not found:', userId)
        return next(new Error('User not found'))
      }

      // Attach user to socket
      socket.data.user = userData

      console.log(
        '[Socket] Auth successful for:',
        userData.email,
        'role:',
        userData.role,
      )
      next()
    } catch (error) {
      console.error('[Socket] Auth error:', error)
      next(new Error('Authentication failed'))
    }
  })

  io.on('connection', (socket: Socket) => {
    const userData = socket.data.user
    console.log(`[Socket] User connected: ${userData.email} (${userData.role})`)

    // Join role-based rooms
    if (userData.role === 'kitchen' || userData.role === 'admin') {
      socket.join('kitchen')
      console.log(`[Socket] ${userData.email} joined kitchen room`)
    }

    if (userData.role === 'cashier' || userData.role === 'admin') {
      socket.join('cashier')
      console.log(`[Socket] ${userData.email} joined cashier room`)
    }

    // Printer role joins printer room
    if (userData.role === 'printer') {
      socket.join('printer')
      console.log(`[Socket] ${userData.email} joined printer room`)

      socket.on('print:status', (data: PrintStatusEvent) => {
        console.log('[Socket] Print status:', data)
        io?.to('cashier').emit('print:status', data)
      })
    }

    // Handle call order event from cashier - broadcast to customer display
    socket.on('order:call', (data: OrderCalledNotification) => {
      console.log('[Socket] Order called:', data)
      calledOrders.set(data.id, data)
      // Broadcast to customer display namespace (all connected clients)
      io?.of('/customer-display').emit('order:called', data)
      // Also broadcast to cashier room so other cashier screens update
      io?.to('cashier').emit('order:called', data)
    })

    // Handle uncall order event
    socket.on('order:uncall', (data: { id: string; orderNumber: string }) => {
      console.log('[Socket] Order uncalled:', data)
      calledOrders.delete(data.id)
      io?.of('/customer-display').emit('order:uncalled', data)
      io?.to('cashier').emit('order:uncalled', data)
    })

    // Handle order completed event - remove from customer display
    socket.on(
      'order:completed',
      (data: { id: string; orderNumber: string }) => {
        console.log('[Socket] Order completed:', data)
        calledOrders.delete(data.id)
        io?.of('/customer-display').emit('order:completed', data)
      },
    )

    // Test ping
    socket.on('ping', (data) => {
      console.log('[Socket] Ping received:', data)
      socket.emit('pong', { received: data, time: new Date().toISOString() })
    })

    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${userData.email}`)
    })
  })

  // Public namespace for customer display (no auth required)
  const customerDisplay = io.of('/customer-display')

  customerDisplay.on('connection', (socket: Socket) => {
    console.log('[Socket] Customer display connected')

    // Send all currently called orders so new/reconnected displays are up to date
    if (calledOrders.size > 0) {
      const orders = Array.from(calledOrders.values())
      console.log(
        `[Socket] Sending ${orders.length} existing called orders to customer display`,
      )
      socket.emit('order:initial-state', orders)
    }

    socket.on('disconnect', () => {
      console.log('[Socket] Customer display disconnected')
    })
  })

  console.log('[Socket] Socket.IO initialized')

  return io
}

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.IO not initialized')
  }
  return io
}

// Get customer display namespace
export const getCustomerDisplayNamespace = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized')
  }
  return io.of('/customer-display')
}

// ===== Kitchen Events =====

export const emitNewOrder = (order: KDSOrder) => {
  try {
    console.log('[Socket] Emitting kds:new-order')
    getIO().to('kitchen').emit('kds:new-order', order)
  } catch (error) {
    console.error('[Socket] Failed to emit new order:', error)
  }
}

export const emitOrderUpdate = (order: KDSOrderUpdate) => {
  try {
    console.log('[Socket] Emitting kds:order-updated')
    getIO().to('kitchen').emit('kds:order-updated', order)
  } catch (error) {
    console.error('[Socket] Failed to emit order update:', error)
  }
}

export const emitOrderRemoved = (orderId: string) => {
  try {
    console.log('[Socket] Emitting kds:order-removed')
    getIO().to('kitchen').emit('kds:order-removed', { id: orderId })
  } catch (error) {
    console.error('[Socket] Failed to emit order removed:', error)
  }
}

// ===== Cashier Events =====

export const emitOrderReady = (order: OrderReadyNotification) => {
  try {
    console.log('[Socket] Emitting order:ready')
    getIO().to('cashier').emit('order:ready', order)

    // Also automatically broadcast to customer display so it shows immediately
    const customerDisplayData: OrderCalledNotification = {
      id: order.id,
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber,
      type: order.type,
      calledAt: new Date().toISOString(),
    }
    console.log(
      '[Socket] Auto-broadcasting to customer display:',
      customerDisplayData,
    )
    calledOrders.set(order.id, customerDisplayData)
    getIO().of('/customer-display').emit('order:called', customerDisplayData)
  } catch (error) {
    console.error('[Socket] Failed to emit order ready:', error)
  }
}

// ===== Types =====

export interface KDSOrder {
  id: string
  orderNumber: string
  tableNumber: string | null
  type: string
  status: string
  notes: string | null
  createdAt: Date
  items: {
    id: string
    name: string
    quantity: number
    notes: string | null
    modifiers: { name: string; price: number }[]
  }[]
}

export interface KDSOrderUpdate {
  id: string
  orderNumber: string
  status: string
}

export interface OrderReadyNotification {
  id: string
  orderNumber: string
  tableNumber: string | null
  type: string
}

export interface OrderCalledNotification {
  id: string
  orderNumber: string
  tableNumber: string | null
  type: string
  calledAt: string
}

// ===== Printer Events =====

export const emitPrintReceipt = (data: PrintReceiptData) => {
  try {
    console.log('[Socket] Emitting print:receipt for order:', data.orderNumber)
    getIO().to('printer').emit('print:receipt', data)
  } catch (error) {
    console.error('[Socket] Failed to emit print receipt:', error)
  }
}

export const emitPrintKitchen = (data: PrintKitchenData) => {
  try {
    console.log('[Socket] Emitting print:kitchen for order:', data.orderNumber)
    getIO().to('printer').emit('print:kitchen', data)
  } catch (error) {
    console.error('[Socket] Failed to emit print kitchen:', error)
  }
}

// ===== Printer Types =====

export interface PrintReceiptData {
  orderId: string
  orderNumber: string
  items: {
    name: string
    quantity: number
    price: number
    modifiers?: { name: string; price: number }[]
  }[]
  subtotal: number
  tax: number
  total: number
  paymentMethod: string
  amountPaid: number
  change: number
  tableNumber?: string | null
  cashier: string
  createdAt: Date
}

export interface PrintKitchenData {
  orderId: string
  orderNumber: string
  tableNumber: string | null
  type: string
  items: {
    name: string
    quantity: number
    notes: string | null
    modifiers?: { name: string; price: number }[]
  }[]
  notes: string | null
  createdAt: Date
}

export interface PrintStatusEvent {
  orderId: string
  type: 'receipt' | 'kitchen'
  status: 'success' | 'failed'
  error?: string
}
