import type { Request, Response, NextFunction } from 'express'

import { fromNodeHeaders } from 'better-auth/node'
import { APIError } from './errorHandler.ts'
import { auth } from '../lib/auth.ts'

type Session = typeof auth.$Infer.Session

export interface AuthenticatedRequest extends Request {
  user: Session['user']
  authSession: Session['session']
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  })

  if (!session) {
    throw new APIError('Unauthorized', 'UnauthorizedError', 401)
  }

  req.user = session.user
  req.authSession = session.session

  next()
}
