import type { JSX } from 'react';

export interface ImageFrameProps {
  src: string;
  alt: string;
  /** Full content width (default) or exactly half (full on phone). */
  width?: 'full' | 'half';
  caption?: string;
  /** Default 'lazy'. Use 'eager' for images near the top of a page. */
  loading?: 'lazy' | 'eager';
}

/** Every image sits in a 1px hairline frame with a 6px radius; never floated, never text-wrapped. */
export function ImageFrame({
  src,
  alt,
  width = 'full',
  caption,
  loading = 'lazy',
}: ImageFrameProps): JSX.Element {
  return (
    <figure className={`jf-image-frame jf-image-frame--${width}`}>
      <div className="jf-image-frame__frame">
        <img
          className="jf-image-frame__img"
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
        />
      </div>
      {caption ? <figcaption className="jf-image-frame__caption">{caption}</figcaption> : null}
    </figure>
  );
}
