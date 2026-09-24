/**
 * Step 3 — supporting documents. The list of types is operator-configured
 * (GET …/documents); none is written here. The server checks the real bytes
 * of each file — the client check below only spares a pointless upload.
 */
import { useState, type ChangeEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FileText, RefreshCw, Trash2,
} from 'lucide-react'
import {
  ApiError, DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES, deleteApplicationDocument,
  fetchApplicationDocuments, uploadApplicationDocument,
  type DocumentChecklist, type UploadedDocument,
} from '@/lib/api'
import { loginPath } from '@/lib/session'
import { Button, Input, Spinner } from '@/components/ui'
import {
  applicationKey, checkFileBeforeUpload, documentsKey, fmtBytes, missingDocumentTypes,
  retryUnlessClientError, serverMessage,
} from './steps'

type ChecklistItem = DocumentChecklist['items'][number]

function withItems(items: ChecklistItem[]): DocumentChecklist {
  return { items, complete: items.every(i => i.uploaded.length > 0) }
}

export function StepDocuments({
  id, onBack, onNext,
}: { id: string; onBack: () => void; onNext: () => void }) {
  const location = useLocation()
  const [announcement, setAnnouncement] = useState('')
  const query = useQuery({
    queryKey: documentsKey(id),
    queryFn: () => fetchApplicationDocuments(id),
    retry: retryUnlessClientError,
  })

  const list = query.data
  const missing = missingDocumentTypes(list)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl sm:text-2xl font-black text-[var(--color-text-1)]">Pièces justificatives</h2>
        {/* Not when the operator requires nothing: the panel below says so,
            and "add a file for each document" would contradict it. */}
        {(!list || list.items.length > 0) && (
          <p className="text-sm text-[var(--color-text-3)] mt-1 leading-relaxed">
            Ajoutez un fichier pour chaque pièce demandée : PDF ou photo (JPEG, PNG, WebP),{' '}
            {fmtBytes(DOCUMENT_MAX_BYTES)} au maximum par fichier.
          </p>
        )}
      </div>

      {/* Announces each upload and removal to screen readers. */}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      {query.isPending ? (
        <div role="status" className="glass p-8 flex items-center justify-center gap-3 text-sm text-[var(--color-text-2)]">
          <Spinner size={18} className="text-[var(--color-electric-blue)]" />
          Chargement des pièces demandées…
        </div>
      ) : !list ? (
        <div role="alert" className="glass-sm p-4 flex items-start gap-3 border border-[var(--color-hot-pink)]/30">
          <AlertTriangle size={16} aria-hidden="true" className="text-[var(--color-hot-pink)] mt-0.5 shrink-0" />
          <div className="flex-1 text-sm text-[var(--color-text-2)]">
            {query.error instanceof ApiError && query.error.status === 401 ? (
              <>
                Votre session a expiré.{' '}
                <Link
                  to={loginPath(location.pathname + location.search)}
                  className="font-bold text-[var(--color-electric-blue)] hover:underline"
                >
                  Se reconnecter
                </Link>
              </>
            ) : query.error instanceof ApiError && query.error.status === 404 ? (
              'Demande introuvable.'
            ) : (
              <>
                Impossible de charger la liste des pièces.{' '}
                <Button variant="ghost" size="sm" onClick={() => query.refetch()}>
                  <RefreshCw size={12} aria-hidden="true" /> Réessayer
                </Button>
              </>
            )}
          </div>
        </div>
      ) : list.items.length === 0 ? (
        <div className="glass p-6 flex items-start gap-3">
          <CheckCircle2 size={18} aria-hidden="true" className="text-[var(--color-success)] shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--color-text-2)]">
            Aucune pièce justificative n'est demandée pour le moment.
          </p>
        </div>
      ) : (
        <>
          <div
            className={
              missing.length > 0
                ? 'rounded-xl border border-[var(--color-neon-yellow)]/40 bg-[var(--color-neon-yellow)]/10 px-4 py-3'
                : 'rounded-xl border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 px-4 py-3'
            }
          >
            {missing.length > 0 ? (
              <>
                <p className="text-sm font-bold text-[var(--color-text-1)]">
                  {missing.length === 1 ? 'Pièce encore manquante :' : `${missing.length} pièces encore manquantes :`}
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm text-[var(--color-text-2)]">
                  {missing.map(m => <li key={m.code}>{m.label}</li>)}
                </ul>
              </>
            ) : (
              <p className="text-sm font-bold text-[var(--color-text-1)] flex items-center gap-2">
                <CheckCircle2 size={16} aria-hidden="true" className="text-[var(--color-success)]" />
                Toutes les pièces demandées ont un fichier.
              </p>
            )}
          </div>

          <ul className="flex flex-col gap-4">
            {list.items.map(item => (
              <li key={item.code}>
                <DocumentTypeCard id={id} item={item} onAnnounce={setAnnouncement} />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack} className="w-full sm:w-auto">
          <ArrowLeft size={16} aria-hidden="true" /> Retour
        </Button>
        <Button type="button" variant="accent" size="lg" onClick={onNext} className="w-full sm:w-auto">
          Continuer <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

function uploadErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return "L'envoi du fichier a échoué. Vérifiez votre connexion et réessayez."
  const server = serverMessage(err.detail)
  switch (err.status) {
    case 413: return server ?? `Ce fichier est trop volumineux (${fmtBytes(DOCUMENT_MAX_BYTES)} au maximum).`
    case 415: return server ?? 'Format non accepté : envoyez un PDF ou une photo JPEG, PNG ou WebP.'
    case 409: return server ?? "Impossible d'ajouter ce fichier : le nombre maximal de fichiers est atteint, ou la demande a déjà été envoyée."
    case 503: return server ?? "Le dépôt de documents n'est pas encore disponible."
    case 404: return server ?? "Ce type de pièce n'est plus demandé. Actualisez la page."
    case 422: return server ?? 'Ce fichier est vide ou illisible.'
    case 401: return "Votre session a expiré : le fichier n'a pas été envoyé."
    default:  return "L'envoi du fichier a échoué. Réessayez."
  }
}

function removeErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return "Le fichier n'a pas pu être retiré. Vérifiez votre connexion et réessayez."
  const server = serverMessage(err.detail)
  switch (err.status) {
    case 409: return server ?? 'Cette demande a déjà été envoyée : ses pièces ne peuvent plus être modifiées.'
    case 503: return server ?? "Le dépôt de documents n'est pas encore disponible."
    case 404: return 'Ce fichier avait déjà été retiré.'
    case 401: return "Votre session a expiré : le fichier n'a pas été retiré."
    default:  return "Le fichier n'a pas pu être retiré. Réessayez."
  }
}

function DocumentTypeCard({
  id, item, onAnnounce,
}: { id: string; item: ChecklistItem; onAnnounce: (text: string) => void }) {
  const qc = useQueryClient()
  const location = useLocation()
  const [pickError, setPickError] = useState<string | null>(null)

  const refreshDocuments = () => qc.invalidateQueries({ queryKey: documentsKey(id) })
  const afterConflict = (err: unknown) => {
    if (!(err instanceof ApiError)) return
    // Sent in the meantime: reload the application so the page turns read-only.
    if (err.status === 409) void qc.invalidateQueries({ queryKey: applicationKey(id) })
    if (err.status === 404 || err.status === 409) void refreshDocuments()
  }

  const upload = useMutation({
    mutationFn: (file: File) => uploadApplicationDocument(id, item.code, file),
    onSuccess: doc => {
      qc.setQueryData<DocumentChecklist>(documentsKey(id), prev => prev && withItems(
        prev.items.map(i => (i.code === item.code ? { ...i, uploaded: [...i.uploaded, doc] } : i)),
      ))
      onAnnounce(`Fichier ajouté pour ${item.label} : ${doc.original_filename}`)
      return refreshDocuments()
    },
    onError: afterConflict,
  })

  const remove = useMutation({
    mutationFn: (doc: UploadedDocument) => deleteApplicationDocument(id, doc.id),
    onSuccess: (_void, doc) => {
      qc.setQueryData<DocumentChecklist>(documentsKey(id), prev => prev && withItems(
        prev.items.map(i => ({ ...i, uploaded: i.uploaded.filter(u => u.id !== doc.id) })),
      ))
      onAnnounce(`Fichier retiré : ${doc.original_filename}`)
      return refreshDocuments()
    },
    onError: afterConflict,
  })

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    // Cleared at once, so the same file can be picked again after an error.
    input.value = ''
    if (!file) return
    const problem = checkFileBeforeUpload(file, DOCUMENT_MAX_BYTES, DOCUMENT_ACCEPT)
    setPickError(problem)
    upload.reset()
    remove.reset()
    if (problem) return
    upload.mutate(file)
  }

  const uploadError = pickError ?? (upload.isError ? uploadErrorText(upload.error) : undefined)
  const sessionExpired = [upload.error, remove.error].some(e => e instanceof ApiError && e.status === 401)
  const done = item.uploaded.length > 0

  return (
    <section aria-label={item.label} className="glass p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-black text-[var(--color-text-1)] break-words">{item.label}</h3>
          {item.description && (
            <p className="text-sm text-[var(--color-text-3)] mt-1 leading-relaxed">{item.description}</p>
          )}
        </div>
        <span
          className={
            done
              ? 'badge shrink-0 bg-[var(--color-success)]/12 text-[var(--color-text-1)] border border-[var(--color-success)]/40'
              : 'badge shrink-0 bg-[var(--color-neon-yellow)]/12 text-[var(--color-text-1)] border border-[var(--color-neon-yellow)]/40'
          }
        >
          {done ? 'Fichier ajouté' : 'Manquante'}
        </span>
      </div>

      {item.uploaded.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={`Fichiers ajoutés pour ${item.label}`}>
          {item.uploaded.map(doc => {
            const removing = remove.isPending && remove.variables?.id === doc.id
            return (
              <li key={doc.id} className="glass-sm flex flex-wrap items-center gap-3 px-3 py-2.5">
                <FileText size={16} aria-hidden="true" className="text-[var(--color-electric-blue)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--color-text-1)] truncate" title={doc.original_filename}>
                    {doc.original_filename}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-3)]">
                    <span className="num">{fmtBytes(doc.byte_size)}</span> · {doc.status_label}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={removing}
                  disabled={remove.isPending || upload.isPending}
                  onClick={() => remove.mutate(doc)}
                  aria-label={`Retirer ${doc.original_filename}`}
                >
                  {!removing && <Trash2 size={12} aria-hidden="true" />} Retirer
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {remove.isError && (
        <p role="alert" className="text-xs text-[var(--color-hot-pink)]">{removeErrorText(remove.error)}</p>
      )}

      <div className="flex flex-col gap-2">
        <Input
          type="file"
          label={`Ajouter un fichier pour ${item.label}`}
          accept={DOCUMENT_ACCEPT}
          onChange={onPick}
          disabled={upload.isPending || remove.isPending}
          error={uploadError}
          hint={`PDF, JPEG, PNG ou WebP · ${fmtBytes(DOCUMENT_MAX_BYTES)} au maximum.`}
          className="h-auto py-2 cursor-pointer file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--color-surface-4)] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-[var(--color-text-1)] file:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        />
        {upload.isPending && (
          <p role="status" className="flex items-center gap-2 text-xs text-[var(--color-text-2)]">
            <Spinner size={14} className="text-[var(--color-electric-blue)]" />
            Envoi du fichier en cours…
          </p>
        )}
        {sessionExpired && (
          <Link
            to={loginPath(location.pathname + location.search)}
            className="self-start text-xs font-bold text-[var(--color-electric-blue)] hover:underline"
          >
            Se reconnecter
          </Link>
        )}
      </div>
    </section>
  )
}
