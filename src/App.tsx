import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import './App.css'
import { type Database, getSupabaseClient, isSupabaseConfigured } from './lib/supabase'
import { deleteImage, isFirebaseConfigured, uploadImage } from './lib/firebase'

type MemoRecord = Database['public']['Tables']['memo_notes']['Row']
type View = 'list' | 'new' | 'edit'

const CARD_IMAGE_PREVIEW_COUNT = 3

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function LinkifiedText({ text }: { text: string }) {
  // Very small linkifier for http(s)://... or www....
  const pattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/g
  const parts: Array<string | { href: string; label: string }> = []

  let lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    const raw = match[0] ?? ''
    if (!raw) continue

    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index))
    }

    const href = raw.startsWith('http') ? raw : `https://${raw}`
    parts.push({ href, label: raw })
    lastIndex = index + raw.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return (
    <>
      {parts.map((part, idx) => {
        if (typeof part === 'string') {
          return <span key={idx}>{part}</span>
        }
        return (
          <a
            key={idx}
            href={part.href}
            target="_blank"
            rel="noreferrer noopener"
            className="memo-link"
          >
            {part.label}
          </a>
        )
      })}
    </>
  )
}

function App() {
  const [view, setView] = useState<View>('list')
  const [memos, setMemos] = useState<MemoRecord[]>([])
  const [isLoadingMemos, setIsLoadingMemos] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [dataError, setDataError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [pendingDeleteMemo, setPendingDeleteMemo] = useState<MemoRecord | null>(null)
  const [viewerImages, setViewerImages] = useState<string[] | null>(null)
  const [viewerIndex, setViewerIndex] = useState(0)
  const viewerTouchStartXRef = useRef<number | null>(null)

  const [editingMemoId, setEditingMemoId] = useState<string | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formImageFiles, setFormImageFiles] = useState<File[]>([])
  const [formImagePreviews, setFormImagePreviews] = useState<string[]>([])
  const [formExistingUrls, setFormExistingUrls] = useState<string[]>([])
  const [originalImageUrls, setOriginalImageUrls] = useState<string[]>([])

  const contentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const supabaseReady = isSupabaseConfigured()
  const firebaseReady = isFirebaseConfigured()

  useEffect(() => {
    if (!statusMessage) return undefined
    const id = window.setTimeout(() => setStatusMessage(''), 2500)
    return () => window.clearTimeout(id)
  }, [statusMessage])

  useEffect(() => {
    if (view !== 'list') {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [view])

  useEffect(() => {
    if (!viewerImages) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setViewerImages(null)
        return
      }
      if (event.key === 'ArrowLeft') {
        setViewerIndex((prev) => Math.max(0, prev - 1))
        return
      }
      if (event.key === 'ArrowRight') {
        setViewerIndex((prev) => Math.min(viewerImages.length - 1, prev + 1))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewerImages])

  useLayoutEffect(() => {
    if (view !== 'list') {
      requestAnimationFrame(() => {
        const el = contentTextareaRef.current
        if (el) {
          el.style.height = 'auto'
          el.style.height = `${el.scrollHeight}px`
        }
      })
    }
  }, [view, formContent])

  function autosizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  const loadMemos = useCallback(async () => {
    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않았어요. `.env`를 먼저 채워 주세요.')
      return
    }
    setIsLoadingMemos(true)
    setDataError('')
    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('memo_notes')
        .select('id, title, content, image_urls, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      setMemos((data ?? []) as MemoRecord[])
    } catch (error) {
      setDataError(getErrorMessage(error))
      setMemos([])
    } finally {
      setIsLoadingMemos(false)
    }
  }, [supabaseReady])

  useEffect(() => {
    void loadMemos()
  }, [loadMemos])

  function openNew() {
    setEditingMemoId(null)
    setFormTitle('')
    setFormContent('')
    setFormImageFiles([])
    setFormImagePreviews([])
    setFormExistingUrls([])
    setOriginalImageUrls([])
    setView('new')
  }

  function openEdit(memo: MemoRecord) {
    setEditingMemoId(memo.id)
    setFormTitle(memo.title)
    setFormContent(memo.content)
    setFormImageFiles([])
    setFormImagePreviews([])
    setFormExistingUrls([...memo.image_urls])
    setOriginalImageUrls([...memo.image_urls])
    setView('edit')
  }

  function closeForm() {
    formImagePreviews.forEach((url) => URL.revokeObjectURL(url))
    setFormImagePreviews([])
    setFormImageFiles([])
    setView('list')
  }

  function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    const newPreviews = files.map((f) => URL.createObjectURL(f))
    setFormImageFiles((prev) => [...prev, ...files])
    setFormImagePreviews((prev) => [...prev, ...newPreviews])
    event.target.value = ''
  }

  function removeNewImage(index: number) {
    URL.revokeObjectURL(formImagePreviews[index])
    setFormImageFiles((prev) => prev.filter((_, i) => i !== index))
    setFormImagePreviews((prev) => prev.filter((_, i) => i !== index))
  }

  function removeExistingImage(url: string) {
    setFormExistingUrls((prev) => prev.filter((u) => u !== url))
  }

  async function handleSave() {
    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않았어요.')
      return
    }

    const title = formTitle.trim()
    if (!title) {
      setStatusMessage('제목을 입력해 주세요.')
      return
    }

    setIsSaving(true)
    setDataError('')

    try {
      let newImageUrls: string[] = []
      if (formImageFiles.length > 0) {
        if (!firebaseReady) {
          setDataError('Firebase 환경 변수가 설정되지 않아 이미지를 업로드할 수 없어요.')
          setIsSaving(false)
          return
        }
        newImageUrls = await Promise.all(formImageFiles.map(uploadImage))
      }

      const allImageUrls = [...formExistingUrls, ...newImageUrls]
      const supabase = getSupabaseClient()

      if (view === 'new') {
        const { error } = await supabase.from('memo_notes').insert({
          title,
          content: formContent.trim(),
          image_urls: allImageUrls,
        })
        if (error) throw error
        setStatusMessage('메모를 저장했어요.')
      } else if (view === 'edit' && editingMemoId) {
        const { error } = await supabase
          .from('memo_notes')
          .update({ title, content: formContent.trim(), image_urls: allImageUrls })
          .eq('id', editingMemoId)
        if (error) throw error

        const removedUrls = originalImageUrls.filter((u) => !formExistingUrls.includes(u))
        await Promise.allSettled(removedUrls.map(deleteImage))
        setStatusMessage('메모를 수정했어요.')
      }

      formImagePreviews.forEach((url) => URL.revokeObjectURL(url))
      setFormImageFiles([])
      setFormImagePreviews([])
      setView('list')
      await loadMemos()
    } catch (error) {
      setDataError(getErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(memo: MemoRecord) {
    if (!supabaseReady) {
      setDataError('Supabase 환경 변수가 설정되지 않았어요.')
      return
    }
    setPendingDeleteMemo(memo)
  }

  async function confirmDelete() {
    const memo = pendingDeleteMemo
    if (!memo) return

    setPendingDeleteMemo(null)
    setDataError('')
    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('memo_notes').delete().eq('id', memo.id)
      if (error) throw error

      await Promise.allSettled(memo.image_urls.map(deleteImage))
      setStatusMessage('메모를 삭제했어요.')
      await loadMemos()
    } catch (error) {
      setDataError(getErrorMessage(error))
    }
  }

  const isFormOpen = view === 'new' || view === 'edit'
  const isDeleteConfirmOpen = pendingDeleteMemo !== null
  const isViewerOpen = viewerImages !== null

  function openViewer(images: string[], index: number) {
    if (images.length === 0) return
    setViewerImages(images)
    setViewerIndex(Math.min(Math.max(index, 0), images.length - 1))
  }

  function closeViewer() {
    setViewerImages(null)
    viewerTouchStartXRef.current = null
  }

  function goPrev() {
    if (!viewerImages) return
    setViewerIndex((prev) => Math.max(0, prev - 1))
  }

  function goNext() {
    if (!viewerImages) return
    setViewerIndex((prev) => Math.min(viewerImages.length - 1, prev + 1))
  }

  return (
    <>
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-title">
            <div className="app-icon">
              <MemoIcon />
            </div>
            <h1>Memo</h1>
          </div>
        </header>

        {!supabaseReady && (
          <section className="notice-card">
            <h2>Supabase 연결이 필요해요</h2>
            <p>`.env`에 URL, Anon Key 값을 넣은 뒤 다시 실행해 주세요.</p>
            <p>테이블 설정은 `supabase-schema.sql` 파일에 정리해 두었습니다.</p>
          </section>
        )}

        {dataError ? (
          <section className="notice-card error-card">
            <h2>처리 중 문제가 생겼어요</h2>
            <p>{dataError}</p>
          </section>
        ) : null}

        {statusMessage ? <div className="toast-message">{statusMessage}</div> : null}

        <main className="content-area">
          {isLoadingMemos ? (
            <section className="empty-state">
              <p>메모를 불러오는 중입니다...</p>
            </section>
          ) : null}

          {!isLoadingMemos && memos.length === 0 ? (
            <section className="empty-state">
              <div className="empty-illustration">
                <MemoIcon />
              </div>
              <h2>아직 저장된 메모가 없어요</h2>
              <p>아래 + 버튼을 눌러 첫 번째 메모를 남겨보세요.</p>
            </section>
          ) : null}

          {!isLoadingMemos && memos.length > 0 ? (
            <div className="memo-list">
              {memos.map((memo) => (
                <MemoCard
                  key={memo.id}
                  memo={memo}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onOpenImages={openViewer}
                />
              ))}
            </div>
          ) : null}
        </main>

        <button type="button" className="fab" aria-label="새 메모 작성" onClick={openNew}>
          <PlusIcon />
        </button>
      </div>

      {isDeleteConfirmOpen ? (
        <div className="form-overlay" role="dialog" aria-modal="true" aria-label="삭제 확인">
          <div className="confirm-dialog">
            <p className="confirm-dialog-message">이 메모를 삭제할까요?</p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="confirm-secondary"
                onClick={() => setPendingDeleteMemo(null)}
              >
                취소
              </button>
              <button type="button" className="confirm-danger" onClick={() => void confirmDelete()}>
                삭제
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isViewerOpen && viewerImages ? (
        <div
          className="viewer-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="이미지 보기"
          onClick={closeViewer}
        >
          <div
            className="viewer-stage"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => {
              viewerTouchStartXRef.current = e.touches[0]?.clientX ?? null
            }}
            onTouchEnd={(e) => {
              const startX = viewerTouchStartXRef.current
              const endX = e.changedTouches[0]?.clientX ?? null
              viewerTouchStartXRef.current = null
              if (startX === null || endX === null) return
              const delta = endX - startX
              if (Math.abs(delta) < 42) return
              if (delta > 0) goPrev()
              else goNext()
            }}
          >
            <button type="button" className="viewer-close" aria-label="닫기" onClick={closeViewer}>
              <CancelIcon />
            </button>

            <button
              type="button"
              className="viewer-nav viewer-nav--prev"
              aria-label="이전 이미지"
              onClick={goPrev}
              disabled={viewerIndex <= 0}
            >
              <ChevronLeftIcon />
            </button>

            <div className="viewer-image-wrap">
              <img src={viewerImages[viewerIndex]} alt="" />
            </div>

            <button
              type="button"
              className="viewer-nav viewer-nav--next"
              aria-label="다음 이미지"
              onClick={goNext}
              disabled={viewerIndex >= viewerImages.length - 1}
            >
              <ChevronRightIcon />
            </button>

            <div className="viewer-counter">
              {viewerIndex + 1} / {viewerImages.length}
            </div>
          </div>
        </div>
      ) : null}

      {isFormOpen ? (
        <div
          className="form-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={view === 'new' ? '새 메모' : '메모 수정'}
        >
          <div className="form-overlay-inner">
            <header className="form-header">
              <button
                type="button"
                className="form-close-button"
                aria-label="닫기"
                onClick={closeForm}
              >
                <CancelIcon />
              </button>
              <h2>{view === 'new' ? '새 메모' : '메모 수정'}</h2>
              <button
                type="button"
                className="form-save-button"
                disabled={isSaving}
                onClick={() => void handleSave()}
              >
                {isSaving ? '저장 중...' : '저장'}
              </button>
            </header>

            <div className="form-body">
              <input
                className="form-title-input"
                type="text"
                placeholder="제목"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                autoFocus
              />

              <textarea
                ref={contentTextareaRef}
                className="form-content-textarea"
                placeholder="내용 (선택)"
                value={formContent}
                onChange={(e) => {
                  setFormContent(e.target.value)
                  autosizeTextarea(e.target)
                }}
              />

              <div className="form-image-section">
                <div className="form-image-grid">
                  {formExistingUrls.map((url) => (
                    <div key={url} className="form-image-thumb">
                      <img src={url} alt="" />
                      <button
                        type="button"
                        className="form-image-remove"
                        aria-label="이미지 제거"
                        onClick={() => removeExistingImage(url)}
                      >
                        <CancelIcon />
                      </button>
                    </div>
                  ))}
                  {formImagePreviews.map((url, idx) => (
                    <div key={url} className="form-image-thumb">
                      <img src={url} alt="" />
                      <button
                        type="button"
                        className="form-image-remove"
                        aria-label="이미지 제거"
                        onClick={() => removeNewImage(idx)}
                      >
                        <CancelIcon />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="form-image-add"
                    aria-label="이미지 추가"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlusIcon />
                    <span>사진 추가</span>
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={handleImageSelect}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

/* ── Sub-components ─────────────────────────────────── */

interface MemoCardProps {
  memo: MemoRecord
  onEdit: (memo: MemoRecord) => void
  onDelete: (memo: MemoRecord) => Promise<void>
  onOpenImages: (images: string[], index: number) => void
}

function MemoCard({ memo, onEdit, onDelete, onOpenImages }: MemoCardProps) {
  const shownImages = memo.image_urls.slice(0, CARD_IMAGE_PREVIEW_COUNT)
  const extra = memo.image_urls.length - CARD_IMAGE_PREVIEW_COUNT

  return (
    <div className="memo-card">
      <div className="memo-card-body">
        <h3 className="memo-card-title">{memo.title}</h3>
        {memo.content ? (
          <p className="memo-card-content">
            <LinkifiedText text={memo.content} />
          </p>
        ) : null}
        {shownImages.length > 0 ? (
          <div className="memo-card-images">
            {shownImages.map((url, idx) => {
              const isLast = idx === shownImages.length - 1
              const showExtra = isLast && extra > 0
              return (
                <button
                  key={url}
                  type="button"
                  className="memo-card-thumb"
                  aria-label="첨부 이미지 보기"
                  onClick={() => onOpenImages(memo.image_urls, idx)}
                >
                  <img src={url} alt="" loading="lazy" />
                  {showExtra ? <div className="memo-card-extra">+{extra}</div> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      <div className="memo-card-footer">
        <span className="memo-card-date">{formatDateLabel(memo.created_at)}</span>
        <div className="memo-card-actions">
          <button
            type="button"
            className="note-icon-button"
            aria-label="메모 수정"
            onClick={() => onEdit(memo)}
          >
            <EditIcon />
          </button>
          <button
            type="button"
            className="note-icon-button"
            aria-label="메모 삭제"
            onClick={() => void onDelete(memo)}
          >
            <DeleteIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Icons ───────────────────────────────────────────── */

function MemoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.25 4.75h7.5l3.5 3.5v10a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-11.5a2 2 0 0 1 2-2Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M14.75 4.75v3.5h3.5M9 10.5h6M9 13.5h6M9 16.5h4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M7.25 4.75h7.5l3.5 3.5v10a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-11.5a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m5 16.75 9.8-9.8a1.8 1.8 0 0 1 2.55 0l.7.7a1.8 1.8 0 0 1 0 2.55L8.25 20H5v-3.25Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 7.5h13M9.5 4.75h5l.75 2.75m-8 0 .55 9.2A2 2 0 0 0 9.8 18.6h4.4a2 2 0 0 0 1.99-1.9l.56-9.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function CancelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m7 7 10 10M17 7 7 17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function ImagePlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="m3 16 5-5 4 4 3-3 4 4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" opacity="0.6" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14.5 6 8.5 12l6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9.5 6 15.5 12l-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default App
