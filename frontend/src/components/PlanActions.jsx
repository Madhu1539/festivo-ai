import {
  Check,
  Download,
  Loader2,
  Pencil,
  RotateCw,
  Save,
  Trash2,
} from 'lucide-react'

/** §7.5 F — Plan Actions. */
export default function PlanActions({
  onEdit,
  onRegenerate,
  onSave,
  onDownload,
  onDelete,
  regenerating = false,
  saving = false,
  saved = false,
  canSave = true,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onEdit && (
        <button type="button" onClick={onEdit} className="btn-secondary">
          <Pencil className="size-4" aria-hidden="true" />
          Edit Event Details
        </button>
      )}

      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          className="btn-secondary"
        >
          {regenerating ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCw className="size-4" aria-hidden="true" />
          )}
          {regenerating ? 'Regenerating…' : 'Regenerate Plan'}
        </button>
      )}

      {onSave && (
        <button
          type="button"
          onClick={onSave}
          disabled={saving || saved || !canSave}
          className={saved ? 'btn-secondary' : 'btn-primary'}
          title={canSave ? undefined : 'Saving is unavailable — check the database'}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : saved ? (
            <Check className="size-4 text-success" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save Plan'}
        </button>
      )}

      {onDownload && (
        <button type="button" onClick={onDownload} className="btn-secondary">
          <Download className="size-4" aria-hidden="true" />
          Download Plan
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="btn-ghost text-danger hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete
        </button>
      )}
    </div>
  )
}
