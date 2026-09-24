import { describe, expect, it } from 'vitest'
import { ApiError, DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES, type DocumentChecklist } from '@/lib/api'
import {
  APPLY_STEPS, applicationKey, applicationsKey, checkFileBeforeUpload, documentsKey,
  EMPTY_PROFILE_FORM, fmtBytes, hasListedProblems, isFutureDate, isoDate, isProfileComplete,
  isValidIsoDate, missingDocumentTypes, parseAmount, parseDependents, parseOptionalAmount,
  parseStep, profileKey, profileToForm, readSubmitProblems, retryUnlessClientError,
  serverMessage, stepHref, stepLabel, trimDecimal, validateProfileForm, type ProfileFormValues,
} from './steps'

describe('query keys — shared with the account pages', () => {
  it('uses exactly the agreed keys, all under "account"', () => {
    expect(applicationsKey()).toEqual(['account', 'applications'])
    expect(applicationKey('a1')).toEqual(['account', 'applications', 'a1'])
    expect(profileKey('a1')).toEqual(['account', 'application-profile', 'a1'])
    expect(documentsKey('a1')).toEqual(['account', 'application-documents', 'a1'])
  })

  it('keeps the detail under the list prefix, so one invalidation covers both', () => {
    expect(applicationKey('a1').slice(0, 2)).toEqual([...applicationsKey()])
  })
})

describe('retryUnlessClientError', () => {
  it('does not retry an answer the server will repeat', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(retryUnlessClientError(0, new ApiError(status, 'x', undefined))).toBe(false)
    }
  })
  it('retries a server or network failure once', () => {
    expect(retryUnlessClientError(0, new ApiError(503, 'x', undefined))).toBe(true)
    expect(retryUnlessClientError(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(retryUnlessClientError(1, new TypeError('Failed to fetch'))).toBe(false)
  })
})

describe('parseStep — ?step= is clamped to 1..4', () => {
  it.each([
    ['1', 1], ['2', 2], ['3', 3], ['4', 4],
    [' 3 ', 3], ['+2', 2], ['03', 3],
  ])('reads %j as %i', (raw, expected) => {
    expect(parseStep(raw)).toBe(expected)
  })

  it.each([
    ['0', 1], ['-2', 1], ['5', 4], ['99', 4], ['123456789012345678901', 4],
  ])('clamps %j to %i', (raw, expected) => {
    expect(parseStep(raw)).toBe(expected)
  })

  it.each([null, undefined, '', '   ', 'abc', '2.5', '1e1', '0x3', 'NaN', 'Infinity', '2abc'])(
    'falls back to step 1 for %j',
    raw => {
      expect(parseStep(raw)).toBe(1)
    },
  )
})

describe('step names and links', () => {
  it('has the four steps in order', () => {
    expect(APPLY_STEPS.map(s => s.label)).toEqual([
      'Récapitulatif', 'Votre situation', 'Pièces justificatives', 'Envoi',
    ])
    expect(stepLabel(3)).toBe('Pièces justificatives')
  })

  it('builds an internal, encoded path', () => {
    expect(stepHref('abc-123', 2)).toBe('/apply/abc-123?step=2')
    expect(stepHref('a/b?c', 4)).toBe('/apply/a%2Fb%3Fc?step=4')
    expect(parseStep(new URL(stepHref('x', 3), 'https://shop.test').searchParams.get('step'))).toBe(3)
  })
})

// Built from code points so the source stays plain ASCII: French number
// formatting groups thousands with these two spaces.
const NBSP = String.fromCharCode(0x00a0)
const NNBSP = String.fromCharCode(0x202f)

describe('parseAmount — decimals stay strings', () => {
  it.each([
    ['48500', '48500'],
    ['48 500', '48500'],
    [`48${NBSP}500`, '48500'],
    [`48${NNBSP}500,5`, '48500.50'],
    ['48500,50', '48500.50'],
    ['48500.5', '48500.50'],
    ['0', '0'],
    ['000120', '120'],
    ['0.5', '0.50'],
    ['9999999999.99', '9999999999.99'],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseAmount(raw)).toEqual({ ok: true, value: expected })
  })

  it.each(['', '  ', '-5', 'abc', '12.345', '1.234,50', '.5', '5.', '1e5', '12345678901', '1,2,3'])(
    'refuses %j',
    raw => {
      expect(parseAmount(raw).ok).toBe(false)
    },
  )

  it('says a negative amount is negative', () => {
    const r = parseAmount('-10')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/négatif/)
  })

  it('treats an empty optional amount as zero', () => {
    expect(parseOptionalAmount('')).toEqual({ ok: true, value: '0' })
    expect(parseOptionalAmount('  ')).toEqual({ ok: true, value: '0' })
    expect(parseOptionalAmount('1500')).toEqual({ ok: true, value: '1500' })
    expect(parseOptionalAmount('x').ok).toBe(false)
  })
})

describe('parseDependents', () => {
  it.each([['', null], ['0', 0], ['3', 3], [' 30 ', 30]])('reads %j as %j', (raw, expected) => {
    expect(parseDependents(raw)).toEqual({ ok: true, value: expected })
  })
  it.each(['31', '-1', '1.5', 'deux', '2,0'])('refuses %j', raw => {
    expect(parseDependents(raw).ok).toBe(false)
  })
})

describe('dates', () => {
  it('writes the local calendar date', () => {
    expect(isoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(isoDate(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })
  it('knows a real date from a fake one', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2026-02-29')).toBe(false)
    expect(isValidIsoDate('2026-13-01')).toBe(false)
    expect(isValidIsoDate('26-01-01')).toBe(false)
    expect(isValidIsoDate('')).toBe(false)
  })
  it('compares ISO dates', () => {
    expect(isFutureDate('2026-09-25', '2026-09-24')).toBe(true)
    expect(isFutureDate('2026-09-24', '2026-09-24')).toBe(false)
    expect(isFutureDate('2019-01-01', '2026-09-24')).toBe(false)
  })
})

describe('trimDecimal / profileToForm', () => {
  it('drops a zero fraction only', () => {
    expect(trimDecimal('48500.00')).toBe('48500')
    expect(trimDecimal('48500.50')).toBe('48500.50')
    expect(trimDecimal('0.00')).toBe('0')
    expect(trimDecimal('100')).toBe('100')
    expect(trimDecimal(null)).toBe('')
  })

  it('starts empty without a saved profile', () => {
    expect(profileToForm(undefined)).toEqual(EMPTY_PROFILE_FORM)
    expect(profileToForm({ financial: null, employment: null })).toEqual(EMPTY_PROFILE_FORM)
  })

  it('prefills from what the server has', () => {
    expect(profileToForm({
      financial: { monthly_income: '52000.00', monthly_obligations: '0.00', dependents: 2 },
      employment: { employment_type: 'CDI', employer_name: null, job_title: 'Technicien', employed_since: '2020-03-01' },
    })).toEqual({
      monthly_income: '52000',
      monthly_obligations: '0',
      dependents: '2',
      employment_type: 'CDI',
      employer_name: '',
      job_title: 'Technicien',
      employed_since: '2020-03-01',
    })
  })

  it('prefills one half when only one is saved', () => {
    const f = profileToForm({
      financial: null,
      employment: { employment_type: 'RETRAITE', employer_name: null, job_title: null, employed_since: null },
    })
    expect(f.monthly_income).toBe('')
    expect(f.employment_type).toBe('RETRAITE')
  })

  it('knows when both halves are saved', () => {
    expect(isProfileComplete(undefined)).toBe(false)
    expect(isProfileComplete({ financial: null, employment: null })).toBe(false)
    expect(isProfileComplete({
      financial: { monthly_income: '1', monthly_obligations: '0', dependents: null },
      employment: null,
    })).toBe(false)
    expect(isProfileComplete({
      financial: { monthly_income: '1', monthly_obligations: '0', dependents: null },
      employment: { employment_type: 'AUTRE', employer_name: null, job_title: null, employed_since: null },
    })).toBe(true)
  })
})

describe('validateProfileForm', () => {
  const TODAY = '2026-09-24'
  const good: ProfileFormValues = {
    monthly_income: '52 000',
    monthly_obligations: '',
    dependents: '',
    employment_type: 'FONCTIONNAIRE',
    employer_name: '  ',
    job_title: ' Enseignant ',
    employed_since: '',
  }

  it('builds the API body: strings for decimals, null for blanks', () => {
    const { input, errors } = validateProfileForm(good, TODAY)
    expect(errors).toEqual({})
    expect(input).toEqual({
      financial: { monthly_income: '52000', monthly_obligations: '0', dependents: null },
      employment: { employment_type: 'FONCTIONNAIRE', employer_name: null, job_title: 'Enseignant', employed_since: null },
    })
  })

  it('keeps a past start date and a dependents count', () => {
    const { input } = validateProfileForm({ ...good, employed_since: '2018-06-01', dependents: '3' }, TODAY)
    expect(input?.employment.employed_since).toBe('2018-06-01')
    expect(input?.financial.dependents).toBe(3)
  })

  it('accepts today as a start date', () => {
    expect(validateProfileForm({ ...good, employed_since: TODAY }, TODAY).input).not.toBeNull()
  })

  it('reports every problem at once', () => {
    const { input, errors } = validateProfileForm({
      monthly_income: '',
      monthly_obligations: '-3',
      dependents: '40',
      employment_type: '',
      employer_name: 'x'.repeat(201),
      job_title: 'y'.repeat(121),
      employed_since: '2026-09-25',
    }, TODAY)
    expect(input).toBeNull()
    expect(Object.keys(errors).sort()).toEqual([
      'dependents', 'employed_since', 'employer_name', 'employment_type',
      'job_title', 'monthly_income', 'monthly_obligations',
    ])
  })

  it('refuses an impossible date', () => {
    const { errors } = validateProfileForm({ ...good, employed_since: '2025-02-30' }, TODAY)
    expect(errors.employed_since).toBeDefined()
  })

  it('refuses an unknown employment type', () => {
    const { errors } = validateProfileForm(
      { ...good, employment_type: 'PIRATE' as ProfileFormValues['employment_type'] },
      TODAY,
    )
    expect(errors.employment_type).toBeDefined()
  })
})

describe('fmtBytes', () => {
  it.each([
    [0, '1 Ko'],
    [512, '1 Ko'],
    [1024, '1 Ko'],
    [1025, '2 Ko'],
    [850 * 1024, '850 Ko'],
    [1023 * 1024, '1023 Ko'],
    [1024 * 1024, '1 Mo'],
    [1.5 * 1024 * 1024, '1,5 Mo'],
    [DOCUMENT_MAX_BYTES, '10 Mo'],
  ])('%i bytes → %s', (n, expected) => {
    expect(fmtBytes(n)).toBe(expected)
  })
  it('refuses nonsense', () => {
    expect(fmtBytes(-1)).toBe('—')
    expect(fmtBytes(Number.NaN)).toBe('—')
  })
})

describe('checkFileBeforeUpload', () => {
  const check = (size: number, type: string) => checkFileBeforeUpload({ size, type }, DOCUMENT_MAX_BYTES, DOCUMENT_ACCEPT)

  it('lets an accepted file through', () => {
    expect(check(200_000, 'application/pdf')).toBeNull()
    expect(check(DOCUMENT_MAX_BYTES, 'image/jpeg')).toBeNull()
    expect(check(10, 'IMAGE/PNG')).toBeNull()
  })
  it('lets the server decide when the browser gives no type', () => {
    expect(check(10, '')).toBeNull()
  })
  it('stops an empty, oversized or unsupported file early', () => {
    expect(check(0, 'application/pdf')).toMatch(/vide/)
    expect(check(DOCUMENT_MAX_BYTES + 1, 'application/pdf')).toMatch(/10 Mo/)
    expect(check(10, 'image/heic')).toMatch(/Format/)
  })
})

describe('missingDocumentTypes', () => {
  const doc = {
    id: 'd1', original_filename: 'cni.pdf', content_type: 'application/pdf',
    byte_size: 10, status: 'UPLOADED' as const, status_label: 'Reçu', uploaded_at: null,
  }
  it('lists the types with no file, in order', () => {
    const list: DocumentChecklist = {
      complete: false,
      items: [
        { code: 'A', label: 'Pièce A', description: null, uploaded: [doc] },
        { code: 'B', label: 'Pièce B', description: 'x', uploaded: [] },
        { code: 'C', label: 'Pièce C', description: null, uploaded: [] },
      ],
    }
    expect(missingDocumentTypes(list)).toEqual([{ code: 'B', label: 'Pièce B' }, { code: 'C', label: 'Pièce C' }])
  })
  it('is empty when nothing is required or not loaded', () => {
    expect(missingDocumentTypes({ items: [], complete: true })).toEqual([])
    expect(missingDocumentTypes(undefined)).toEqual([])
  })
})

describe('server payloads', () => {
  it('reads the server sentence from a string or an object', () => {
    expect(serverMessage('Demande introuvable.')).toBe('Demande introuvable.')
    expect(serverMessage({ message: 'Pas encore.' })).toBe('Pas encore.')
    expect(serverMessage([{ msg: 'x' }])).toBeNull()
    expect(serverMessage(undefined)).toBeNull()
    expect(serverMessage('  ')).toBeNull()
  })

  it('reads every submit problem', () => {
    const p = readSubmitProblems({
      message: 'La demande ne peut pas encore être envoyée.',
      missing_profile: true,
      missing_documents: [{ code: 'CNI', label: "Pièce d'identité" }, { nope: 1 }],
      reasons: [{ code: 'DEBT_RATIO_EXCEEDED', label: 'Taux trop élevé' }],
    })
    expect(p).toEqual({
      message: 'La demande ne peut pas encore être envoyée.',
      missing_profile: true,
      missing_documents: [{ code: 'CNI', label: "Pièce d'identité" }],
      reasons: [{ code: 'DEBT_RATIO_EXCEEDED', label: 'Taux trop élevé' }],
    })
    expect(p && hasListedProblems(p)).toBe(true)
  })

  it('is not fooled by a validation error list', () => {
    expect(readSubmitProblems([{ msg: 'field required' }])).toBeNull()
    expect(readSubmitProblems('texte')).toBeNull()
    expect(readSubmitProblems(null)).toBeNull()
    expect(readSubmitProblems({ missing_profile: true })).toBeNull()
  })

  it('knows when nothing specific is listed', () => {
    expect(hasListedProblems({ message: 'x' })).toBe(false)
    expect(hasListedProblems({ message: 'x', missing_documents: [] })).toBe(false)
  })
})
