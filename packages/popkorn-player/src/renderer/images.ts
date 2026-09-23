// Image cache entry by src; `img` is null until decoded.
export interface ImageEntry<T> {
  img: T | null;
  loaded: boolean;
  errored: boolean;
}

/** In-flight image decodes; each tracked promise settles (never rejects) on load/error. */
export class PendingImages {
  private set = new Set<Promise<void>>();

  track(p: Promise<void>): void {
    this.set.add(p);
    void p.finally(() => this.set.delete(p));
  }

  settled(): Promise<void> {
    return Promise.all([...this.set]).then(() => undefined);
  }

  get size(): number {
    return this.set.size;
  }
}

// Resolved drawImage source rect + destination size; callers own and reuse one, so draws don't allocate.
export interface ImageDest {
  cropped: boolean;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dw: number;
  dh: number;
}

export function newImageDest(): ImageDest {
  return { cropped: false, sx: 0, sy: 0, sw: 0, sh: 0, dw: 0, dh: 0 };
}

/** Source = the crop (object-view-box) when all four are given, else the whole image; a non-positive box sizes to the source. */
export function resolveImageDest(
  out: ImageDest,
  w: number,
  h: number,
  naturalW: number,
  naturalH: number,
  sx?: number,
  sy?: number,
  sw?: number,
  sh?: number,
): ImageDest {
  if (
    sx !== undefined &&
    sy !== undefined &&
    sw !== undefined &&
    sh !== undefined
  ) {
    out.cropped = true;
    out.sx = sx;
    out.sy = sy;
    out.sw = sw;
    out.sh = sh;
  } else {
    out.cropped = false;
    out.sx = 0;
    out.sy = 0;
    out.sw = naturalW;
    out.sh = naturalH;
  }
  out.dw = w > 0 ? w : out.sw;
  out.dh = h > 0 ? h : out.sh;
  return out;
}
