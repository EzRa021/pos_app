// features/users/AvatarUploader.jsx
// Full avatar management widget: drag-drop upload, canvas resize to 256×256,
// optimistic preview, and remove button.
//
// Props:
//   user          – user object (needs .id, .avatar?, .first_name?, .last_name?, .role_slug?)
//   onUserChange  – callback(updatedUser) fired after a successful upload or remove
//   canEdit       – bool (defaults true) — hides controls when false (read-only)

import { useRef, useState, useCallback } from "react";
import { Camera, Trash2, Upload, Loader2, X } from "lucide-react";
import { useMutation, useQueryClient }        from "@tanstack/react-query";
import { cn }                                  from "@/lib/utils";
import { toastSuccess, onMutationError }       from "@/lib/toast";
import { uploadUserAvatar, removeUserAvatar }  from "@/commands/users";
import UserAvatar                              from "@/components/shared/UserAvatar";

// ── Client-side resize helper ──────────────────────────────────────────────────
// Converts any image File → 256×256 center-cropped WebP data URI.
async function processImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("Please select an image file.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const SIZE = 256;
        const canvas = document.createElement("canvas");
        canvas.width  = SIZE;
        canvas.height = SIZE;
        const ctx  = canvas.getContext("2d");
        const side = Math.min(img.width, img.height);
        const sx   = (img.width  - side) / 2;
        const sy   = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
        resolve(canvas.toDataURL("image/webp", 0.88));
      };
      img.onerror = () => reject(new Error("Failed to decode image."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export function AvatarUploader({ user, onUserChange, canEdit = true }) {
  const fileRef    = useRef(null);
  const qc         = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const [preview,  setPreview]  = useState(null); // optimistic local preview
  const [error,    setError]    = useState(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["user", user?.id] });
  };

  const upload = useMutation({
    mutationFn: ({ id, avatar }) => uploadUserAvatar(id, avatar),
    onSuccess: (updatedUser) => {
      setPreview(null);
      toastSuccess("Photo Updated", "Profile photo has been saved.");
      invalidate();
      onUserChange?.(updatedUser);
    },
    onError: (e) => {
      setPreview(null);
      setError(typeof e === "string" ? e : (e?.message ?? "Upload failed"));
      onMutationError("Upload Failed", e);
    },
  });

  const remove = useMutation({
    mutationFn: ({ id }) => removeUserAvatar(id),
    onSuccess: (updatedUser) => {
      setPreview(null);
      toastSuccess("Photo Removed", "Profile photo has been removed.");
      invalidate();
      onUserChange?.(updatedUser);
    },
    onError: (e) => onMutationError("Remove Failed", e),
  });

  const isPending = upload.isPending || remove.isPending;

  const handleFile = useCallback(async (file) => {
    if (!file || !user?.id) return;
    setError(null);
    try {
      const dataUri = await processImage(file);
      setPreview(dataUri);
      upload.mutate({ id: user.id, avatar: dataUri });
    } catch (err) {
      setError(err.message);
    }
  }, [upload, user?.id]);

  const handleRemove = useCallback(() => {
    if (!user?.id) return;
    setError(null);
    setPreview(null);
    remove.mutate({ id: user.id });
  }, [remove, user?.id]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // Effective user shown in the big preview circle
  const displayUser = preview ? { ...user, avatar: preview } : user;
  const hasAvatar   = !!(preview ?? user?.avatar);

  return (
    <div className="flex flex-col items-center gap-4">

      {/* ── Large avatar + camera overlay ── */}
      <div
        className={cn(
          "relative group transition-all duration-200",
          dragging && "scale-105",
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {/* Ring around the avatar */}
        <div className={cn(
          "rounded-2xl overflow-hidden ring-2 transition-all duration-200",
          dragging
            ? "ring-primary ring-offset-2 ring-offset-background"
            : "ring-border",
        )}>
          <UserAvatar user={displayUser} size={96} rounded="xl" />
        </div>

        {/* Hover / drag overlay — only when editable */}
        {canEdit && (
          <div
            className={cn(
              "absolute inset-0 rounded-2xl flex items-center justify-center",
              "bg-black/55 transition-opacity duration-150 cursor-pointer",
              dragging || isPending ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            onClick={() => !isPending && fileRef.current?.click()}
          >
            {isPending
              ? <Loader2 className="h-6 w-6 text-white animate-spin" />
              : dragging
                ? <Upload  className="h-6 w-6 text-white" />
                : <Camera  className="h-6 w-6 text-white" />
            }
          </div>
        )}

        {/* Remove badge — visible on hover when photo exists */}
        {canEdit && hasAvatar && !isPending && (
          <button
            type="button"
            onClick={handleRemove}
            className={cn(
              "absolute -bottom-1.5 -right-1.5",
              "h-7 w-7 rounded-full flex items-center justify-center",
              "bg-destructive text-white border-2 border-background",
              "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
              "hover:bg-destructive/80",
            )}
            title="Remove photo"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Action buttons ── */}
      {canEdit && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "h-7 px-3 rounded-lg flex items-center gap-1.5",
              "text-[10px] font-semibold uppercase tracking-wider",
              "bg-muted hover:bg-muted/70 text-foreground border border-border",
              "transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            <Camera className="h-3 w-3" />
            {hasAvatar ? "Change photo" : "Upload photo"}
          </button>

          {hasAvatar && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleRemove}
              className={cn(
                "h-7 px-3 rounded-lg flex items-center gap-1.5",
                "text-[10px] font-semibold uppercase tracking-wider",
                "bg-destructive/10 hover:bg-destructive/20 text-destructive",
                "border border-destructive/20 transition-colors duration-150",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </button>
          )}
        </div>
      )}

      {/* ── Hint ── */}
      {canEdit && (
        <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
          JPG, PNG or WebP · Max ~200 KB · Auto-cropped to square
          <br />
          {hasAvatar ? "Hover the photo to change or remove" : "Drag & drop or click to upload"}
        </p>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-2 w-full px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
          <X className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-[11px] text-destructive leading-snug">{error}</p>
        </div>
      )}

      {/* ── Hidden file input ── */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
        onClick={(e) => { e.target.value = ""; }}
      />
    </div>
  );
}
