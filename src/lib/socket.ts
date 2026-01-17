import type { Server as HTTPServer } from 'http'
import { Server, Socket } from 'socket.io'
import db from '../db/connection.ts'
import { user } from '../db/schema/auth.ts'
import { eq } from 'drizzle-orm'

let io: Server | null = null

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

    // Test ping
    socket.on('ping', (data) => {
      console.log('[Socket] Ping received:', data)
      socket.emit('pong', { received: data, time: new Date().toISOString() })
    })

    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${userData.email}`)
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
}
