import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import db from '../db/connection.ts'
import { admin } from 'better-auth/plugins'
import { oneTimeToken } from 'better-auth/plugins/one-time-token'
import { apiKey } from '@better-auth/api-key'
import env from '../env.ts'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'cashier',
      },
    },
  },
  plugins: [
    admin({
      defaultRole: 'cashier',
      adminRoles: ['admin'],
    }),
    oneTimeToken({
      expiresIn: 5,
    }),
    apiKey({
      enableSessionForAPIKeys: true,
    }),
  ],
  trustedOrigins: [env.FRONTEND_URL],
  advanced: {
    crossSubDomainCookies: {
      enabled: false,
    },
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: true,
      path: '/',
    },
  },
})
