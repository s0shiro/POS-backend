import { createServer } from 'http'
import env from '../env.ts'
import app from './server.ts'
import { initSocket } from './lib/socket.ts'

// Create HTTP server from Express app
const httpServer = createServer(app)

// Initialize Socket.IO
initSocket(httpServer)

httpServer.listen(env.PORT, () => {
  console.log(`API listening at http://localhost:${env.PORT}`)
  console.log(`WebSocket server ready`)
})
