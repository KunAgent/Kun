"""Image preprocessing for upload-image CLI subcommand.

Local images may arrive in any format / size (heic from iPhone, 8MB jpeg, etc.)
The ai-shifu backend does not transcode or resize — it inspects the filename
extension to pick content-type and forwards bytes to OSS. So the skill must
normalize images locally before uploading:

- decode anything Pillow can read (+ HEIC via pillow-heif)
- correct EXIF orientation
- cap longest side at 2048 px
- output JPEG q=85 (or PNG when alpha is needed); recompress until <= 2 MB
- name the file with a content-hash suffix so duplicates collapse cleanly
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image, ImageOps, UnidentifiedImageError
except ImportError as e:
    raise SystemExit(
        "Pillow not installed. Run: pip install -r scripts/requirements.txt"
    ) from e

_HEIF_REGISTERED = False


def _register_heif_if_available() -> bool:
    """Lazily register pillow-heif so HEIC/HEIF inputs decode via PIL.open()."""
    global _HEIF_REGISTERED
    if _HEIF_REGISTERED:
        return True
    try:
        import pillow_heif  # type: ignore
    except ImportError:
        return False
    pillow_heif.register_heif_opener()
    _HEIF_REGISTERED = True
    return True


MAX_SIDE = 2048
MAX_BYTES = 2 * 1024 * 1024
JPEG_QUALITY_LADDER = (85, 80, 75, 70, 65)
HEIC_EXTS = {".heic", ".heif", ".heics", ".heifs"}


@dataclass
class PreparedImage:
    """The result of preparing a local image for upload."""

    data: bytes
    filename: str  # includes extension; passed to multipart filename
    mime: str
    original_path: Path
    original_bytes: int


def prepare_image(src_path: Path) -> PreparedImage:
    """Read src_path, normalize for upload, return processed bytes + filename.

    Raises ValueError on non-image / unreadable input. The caller is responsible
    for catching and reporting it as a user-friendly error.
    """
    src_path = Path(src_path)
    if not src_path.exists():
        raise ValueError(f"file not found: {src_path}")
    if not src_path.is_file():
        raise ValueError(f"not a regular file: {src_path}")

    original_bytes = src_path.stat().st_size

    heif_available = _register_heif_if_available()
    if src_path.suffix.lower() in HEIC_EXTS and not heif_available:
        raise ValueError(
            f"{src_path.suffix} requires pillow-heif. "
            "Install with: pip install -r scripts/requirements.txt"
        )

    try:
        with Image.open(src_path) as im:
            im.load()
            im = ImageOps.exif_transpose(im)
            has_alpha = _has_alpha(im)
            im = _resize_if_needed(im, MAX_SIDE)
            if has_alpha:
                data, ext, mime = _encode_png(im, MAX_BYTES)
            else:
                data, ext, mime = _encode_jpeg_under_limit(im, MAX_BYTES)
    except UnidentifiedImageError as e:
        raise ValueError(f"not a recognizable image: {src_path}") from e
    except OSError as e:
        raise ValueError(f"failed to decode image {src_path}: {e}") from e

    stem = _safe_stem(src_path.stem)
    digest = hashlib.sha1(data).hexdigest()[:8]
    filename = f"{stem}-{digest}{ext}"

    return PreparedImage(
        data=data,
        filename=filename,
        mime=mime,
        original_path=src_path,
        original_bytes=original_bytes,
    )


def _has_alpha(im: Image.Image) -> bool:
    if im.mode in ("RGBA", "LA"):
        extrema = im.getextrema()
        if im.mode == "RGBA":
            min_alpha = extrema[3][0]
        else:
            min_alpha = extrema[1][0]
        return min_alpha < 255
    if im.mode == "P" and "transparency" in im.info:
        return True
    return False


def _resize_if_needed(im: Image.Image, max_side: int) -> Image.Image:
    w, h = im.size
    longest = max(w, h)
    if longest <= max_side:
        return im
    scale = max_side / longest
    new_size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    return im.resize(new_size, Image.LANCZOS)


_DOWNSCALE_ROUNDS = 6


def _encode_jpeg_under_limit(
    im: Image.Image, max_bytes: int
) -> tuple[bytes, str, str]:
    if im.mode != "RGB":
        im = im.convert("RGB")
    for q in JPEG_QUALITY_LADDER:
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=q, optimize=True, progressive=True)
        data = buf.getvalue()
        if len(data) <= max_bytes:
            return data, ".jpg", "image/jpeg"

    work = im
    for _ in range(_DOWNSCALE_ROUNDS):
        next_im = _resize_if_needed(work, max(work.size) * 3 // 4)
        if next_im is work:
            break
        work = next_im
        buf = io.BytesIO()
        work.save(
            buf, format="JPEG", quality=JPEG_QUALITY_LADDER[-1],
            optimize=True, progressive=True,
        )
        data = buf.getvalue()
        if len(data) <= max_bytes:
            return data, ".jpg", "image/jpeg"

    raise ValueError(
        f"image cannot be compressed under {max_bytes} bytes without excessive loss"
    )


def _encode_png(im: Image.Image, max_bytes: int) -> tuple[bytes, str, str]:
    if im.mode not in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
    work = im
    for _ in range(_DOWNSCALE_ROUNDS + 1):
        buf = io.BytesIO()
        work.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
        if len(data) <= max_bytes:
            return data, ".png", "image/png"
        next_im = _resize_if_needed(work, max(work.size) * 3 // 4)
        if next_im is work:
            break
        work = next_im

    raise ValueError(
        f"PNG cannot be compressed under {max_bytes} bytes without excessive loss"
    )


def _safe_stem(stem: str) -> str:
    """Strip path-unsafe chars; cap length; fall back to 'image'."""
    cleaned = "".join(c if c.isalnum() or c in "-_." else "-" for c in stem)
    cleaned = cleaned.strip("-.")
    cleaned = cleaned[:48]
    return cleaned or "image"
