import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import db from '../db/connection.ts'
import { admin } from 'better-auth/plugins'
import env from '../../env.ts'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [admin({ defaultRole: 'cashier' })],
  trustedOrigins: [env.FRONTEND_URL],
  advanced: { disableOriginCheck: true },
})
