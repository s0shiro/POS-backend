import { Pool } from 'pg'
import { env, isProd } from '../../env.ts'
import * as schema from './schema/index.ts'
import { remember } from '@epic-web/remember'
import { drizzle } from 'drizzle-orm/node-postgres'

const createPool = () => {
  return new Pool({
    connectionString: env.DATABASE_URL,
  })
}

let client

if (isProd()) {
  client = createPool()
} else {
  client = remember('dbPool', () => createPool())
}

export const db = drizzle({ client, schema })

export default db
