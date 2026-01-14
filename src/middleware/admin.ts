import { auth } from '../lib/auth.ts'

export const adminMiddleware = async (req, res, next) => {
  const session = await auth.api.getSession({ headers: req.headers })

  if (session?.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access only' })
  }

  next()
}
