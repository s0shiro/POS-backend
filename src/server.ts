import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import env, { isTest } from '../env.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { toNodeHandler } from 'better-auth/node'
import { auth } from './lib/auth.ts'

import categoriesRouter from './routes/categoriesRoutes.ts'
import menuItemsRouter from './routes/menuItemsRoutes.ts'
import tablesRouter from './routes/tablesRoutes.ts'
import ordersRouter from './routes/ordersRoutes.ts'
import paymentsRouter from './routes/paymentsRoutes.ts'
import kdsRouter from './routes/kdsRoutes.ts'

const app = express()
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", 'cdn.jsdelivr.net'],
        'style-src': ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
      },
    },
  }),
)
app.use(
  cors({
    origin: [env.FRONTEND_URL],
    credentials: true,
  }),
)
app.use(
  morgan('dev', {
    skip: () => isTest(),
  }),
)

app.all('/api/auth/{*any}', toNodeHandler(auth))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.get('/health', (req, res) => {
  res.json({ message: 'Ok!' })
})

app.use(errorHandler)

app.use('/api/menu/categories', categoriesRouter)
app.use('/api/menu/items', menuItemsRouter)
app.use('/api/tables', tablesRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/payments', paymentsRouter)
app.use('/api/kds', kdsRouter)

export default app
