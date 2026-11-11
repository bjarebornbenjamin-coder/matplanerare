import { describe, expect, it } from 'vitest'
import { httpsUrl } from './recipeLink'

describe('receptlänkar', () => {
  it('blir bara klickbara om de är https', () => {
    expect(httpsUrl('https://www.ica.se/recept/x/')).toBe('https://www.ica.se/recept/x/')
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://www.ica.se/', 'vbscript:x', '//evil.example.com', 'inte en adress', '', undefined])
      expect([bad, httpsUrl(bad)]).toEqual([bad, undefined])
  })
})
