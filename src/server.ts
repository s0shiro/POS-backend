import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import helmet from 'helmet'
import env, { isTest } from '../env.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { toNodeHandler } from 'better-auth/node'
import { requireAuth } from './middleware/requireAuth.ts'
import { auth } from './lib/auth.ts'

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

app.get('/health', requireAuth, (req, res) => {
  res.json({ message: 'Ok!' })
})

app.use(errorHandler)

export default app
