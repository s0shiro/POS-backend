import env from '../env.ts'
import app from './server.ts'

app.listen(env.PORT, () => {
  console.log(`API listening at http://localhost:${env.PORT}`)
})
