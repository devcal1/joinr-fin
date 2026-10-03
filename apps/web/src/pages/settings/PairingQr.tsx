// The pairing QR code (stage-9.md §8.2, R49): one SVG path drawn from `qrModel` (module units, the
// 4-module quiet zone) on a white tile, `crispEdges`, sized to a whole number of pixels per module
// (4 on a desktop, 3 on a phone). The white tile is the one white surface in the app (§15 item 13):
// scanners need dark modules on a light ground. The payload is never rendered as a link (R29).
import { MEDIA, useMediaQuery } from '@joinr/ui';
import { useMemo, type JSX } from 'react';
import { qrModel } from './qrModel';
import { QR_ARIA_LABEL, qrPixelsPerModule } from './phoneDisplay';

export function PairingQr({ payload }: { payload: string }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const model = useMemo(() => qrModel(payload), [payload]);
  const px = model.size * qrPixelsPerModule(phone);
  return (
    <svg
      className="jf-app-phone-qr"
      role="img"
      aria-label={QR_ARIA_LABEL}
      viewBox={`0 0 ${model.size} ${model.size}`}
      width={px}
      height={px}
      shapeRendering="crispEdges"
      data-testid="phone-qr"
    >
      <rect className="jf-app-phone-qr__tile" width={model.size} height={model.size} />
      <path className="jf-app-phone-qr__modules" d={model.path} />
    </svg>
  );
}
