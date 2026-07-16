"""Primary-monitor capture, ported from the prototype.

mss grab -> PIL -> downscale to max width -> JPEG bytes. Uses ``mss.MSS()``
(the lowercase ``mss.mss`` alias is deprecated). Window-targeted capture is
a planned upgrade (PLAN "Ideas worth folding in").
"""

from __future__ import annotations

import io


def capture_screenshot(max_width: int = 1024, jpeg_quality: int = 70, monitor: int = 1) -> bytes:
    """Grab a monitor (1 = primary), downscale, return JPEG bytes."""
    import mss
    from PIL import Image

    with mss.MSS() as sct:
        shot = sct.grab(sct.monitors[monitor])
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")

    if img.width > max_width:
        ratio = max_width / img.width
        img = img.resize((max_width, int(img.height * ratio)))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=jpeg_quality)
    return buf.getvalue()
