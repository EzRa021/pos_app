// ============================================================================
// LogoUpload — reusable image upload with canvas compression
// ============================================================================
// Props:
//   value     — current image as a base64 data URL (or null / undefined)
//   onChange  — called with the new data URL string, or null when cleared
//   label     — field label text (default "Logo")
//   hint      — optional hint text beneath the upload area
//   size      — "sm" (56px) | "md" (72px, default) | "lg" (96px)
//   round     — boolean, makes the preview circle instead of rounded-square
//
// Compression: max 400×400 px, JPEG quality 0.82. Images already smaller
// than the limit are not upscaled. Output is always JPEG data URL.
// ============================================================================

import { useRef } from "react";
import { Camera, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_PX   = 400;
const QUALITY  = 0.82;

function compress(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(1, MAX_PX / Math.max(img.width, img.height));
      const w = Math.round(img.width  * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", QUALITY));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

const SIZE_MAP = {
  sm: "h-14 w-14",
  md: "h-[72px] w-[72px]",
  lg: "h-24 w-24",
};

export function LogoUpload({
  value,
  onChange,
  label = "Logo",
  hint,
  size  = "md",
  round = false,
  className,
}) {
  const inputRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so selecting the same file again still fires onChange
    e.target.value = "";
    try {
      const dataUrl = await compress(file);
      onChange(dataUrl);
    } catch {
      // Bad image — silently ignore
    }
  }

  const shapeClass = round ? "rounded-full" : "rounded-xl";

  return (
    <div className={cn("space-y-2", className)}>
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
            Remove
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {/* Upload / preview area */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "group relative flex shrink-0 items-center justify-center overflow-hidden border-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          SIZE_MAP[size],
          shapeClass,
          value
            ? "border-border hover:border-primary/60"
            : "border-dashed border-border/70 bg-muted/20 hover:border-primary/60 hover:bg-primary/[0.04]",
        )}
      >
        {value ? (
          <>
            <img
              src={value}
              alt="logo preview"
              className={cn("h-full w-full object-cover", shapeClass)}
            />
            {/* Hover overlay */}
            <div
              className={cn(
                "absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity duration-150",
                shapeClass,
              )}
            >
              <Camera className="h-4 w-4 text-white drop-shadow" />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <Upload className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary/60 transition-colors" />
            <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/40 group-hover:text-primary/50 transition-colors leading-none">
              Upload
            </span>
          </div>
        )}
      </button>

      {hint && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">{hint}</p>
      )}
    </div>
  );
}
