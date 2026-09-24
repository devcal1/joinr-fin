import type { JSX, ReactNode } from 'react';

export interface GalleryItemProps {
  /** Stable name that the e2e specs assert via `[data-gallery-item="<name>"]`. */
  name: string;
  note?: string;
  children: ReactNode;
}

/** One exhibit in the /styleguide gallery. It never hides overflow: wide demos scroll themselves. */
export function GalleryItem({ name, note, children }: GalleryItemProps): JSX.Element {
  return (
    <figure className="jf-app-gallery-item" data-gallery-item={name}>
      <figcaption className="jf-app-gallery-item__caption">
        {name}
        {note ? <span className="jf-app-gallery-item__note">{note}</span> : null}
      </figcaption>
      <div className="jf-app-gallery-item__body">{children}</div>
    </figure>
  );
}
