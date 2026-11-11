import { AiError, describeError } from './errors'

export function visionMessages(system: string, text: string, imageDataUrl: string) {
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
      ],
    },
  ]
}

/** Skickar en bild via appens server till OpenAI i JSON-läge och returnerar råtexten i svaret. */
export async function callVision(
  o: { system: string; text: string; image: string; model: string; headers: Record<string, string> },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  let res: Response
  try {
    res = await fetchFn('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...o.headers },
      body: JSON.stringify({ model: o.model, messages: visionMessages(o.system, o.text, o.image), response_format: { type: 'json_object' } }),
    })
  } catch {
    throw new AiError('Kunde inte nå servern. Kontrollera internetanslutningen.')
  }
  if (!res.ok) throw new AiError(await describeError(res))
  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new AiError('Tomt svar från AI:n.')
  return content
}
