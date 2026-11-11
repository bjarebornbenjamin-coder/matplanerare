import { handleAi } from './_lib/openai.js'
import { adapt } from './_lib/vercel.js'

export default adapt((req, env) => handleAi(req, env))
