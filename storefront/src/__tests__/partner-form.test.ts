import { describe, expect, it } from 'vitest'
import { validatePartnerForm } from '@/pages/Partners'

const VALID = {
  business_name: 'Électro Hydra', activity: 'ELECTROMENAGER' as const, contact_name: 'Karim',
  owner_name: '', phone: '021 23 45 67', email: '', wilaya_code: '16', commune: 'Hydra',
  address: '12 rue X', reason: '',
}

describe('partner application form', () => {
  it('accepts a complete form with a landline', () => {
    expect(validatePartnerForm(VALID)).toEqual({})
  })

  it('reports every missing required field at once', () => {
    const errors = validatePartnerForm({ ...VALID, business_name: ' ', activity: '', wilaya_code: '', address: '' })
    expect(Object.keys(errors).sort()).toEqual(['activity', 'address', 'business_name', 'wilaya_code'])
  })

  it('refuses a number shorter than the server accepts', () => {
    expect(validatePartnerForm({ ...VALID, phone: '1234 567' }).phone).toBeTruthy()
  })

  it('checks an e-mail only when one is given', () => {
    expect(validatePartnerForm({ ...VALID, email: 'pas-un-email' }).email).toBeTruthy()
    expect(validatePartnerForm({ ...VALID, email: '' }).email).toBeUndefined()
  })
})
