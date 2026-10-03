// Settings → Phone (stage-9.md §8.2; D138): pair the phone app by QR (the server address and a
// one-time code, valid 5 minutes), list the paired phones with their last use, remove one. Placed
// between Backups and About. The page never sees a phone's key: only the open pairing code comes
// here, shown as a QR code (for the app's own Scan button) and as text for pairing by hand.
// Times are in the server's zone (Backups' schedule zone), like every time on Settings.
import {
  pairingUrl,
  normaliseServerUrl,
  type PhoneDeviceDto,
  type PhonePairingDto,
  type PhoneSectionResponse,
} from '@joinr/schema';
import {
  Button,
  Callout,
  ColumnTable,
  MEDIA,
  SectionBar,
  TextField,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { QrCode, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { errorMessage } from '../../api/client';
import { queryKeys, useCancelPairing, useOpenPairing, useRevokePhone } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { QueryStates } from '../../components/QueryStates';
import { DeleteConfirm } from '../cashflow/forms';
import { PairingQr } from './PairingQr';
import {
  ADDRESS_ERROR,
  ADDRESS_LABEL,
  CANCEL_BUTTON,
  CODE_LABEL,
  EXPIRED_TEXT,
  FAILURES_TEXT,
  FAILURES_TITLE,
  NEW_CODE_BUTTON,
  NO_PHONE_TEXT,
  PAIRED_PHONES_TITLE,
  PAIR_BUTTON,
  PAIR_TITLE,
  PENDING_REMOVALS_TEXT,
  PHONE_LEAD,
  PHONE_SECTION_ID,
  QR_CAPTION,
  REMOVED_PHONES_TITLE,
  SET_ASIDE_TEXT,
  SET_ASIDE_TITLE,
  UNWRITABLE_TEXT,
  UNWRITABLE_TITLE,
  addressNote,
  appVersionText,
  atLimit,
  closedReason,
  countdownText,
  defaultAddress,
  formatPairingCode,
  lastUsedText,
  limitText,
  msLeft,
  pairedDate,
  pairedText,
  removeQuestion,
  removedText,
} from './phoneDisplay';
import './phone.css';

const PAIRED_TITLE_ID = 'phone-paired';
const PAIR_TITLE_ID = 'phone-pair';
const PAIR_REASON_ID = 'phone-pair-reason';

type Outcome = { kind: 'done'; text: string } | { kind: 'error'; title: string; text: string };

/** The clock, ticking every second while `active` (the countdown); otherwise read once. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    // Read the clock as soon as the countdown starts: the first value may date from the page's load
    // (a code opened minutes later would show more than 5:00 for a second).
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [active]);
  return now;
}

function StoreProblem({ data }: { data: PhoneSectionResponse }): JSX.Element | null {
  if (data.storeProblem === 'set_aside') {
    return (
      <Callout kind="important" title={SET_ASIDE_TITLE}>
        <p>{SET_ASIDE_TEXT}</p>
      </Callout>
    );
  }
  if (data.storeProblem === 'unwritable') {
    return (
      <Callout kind="important" title={UNWRITABLE_TITLE}>
        <p>{UNWRITABLE_TEXT}</p>
        {data.pendingRemovals > 0 ? <p>{PENDING_REMOVALS_TEXT}</p> : null}
      </Callout>
    );
  }
  return null;
}

function PairedPhones({
  data,
  timeZone,
  onAnnounce,
}: {
  data: PhoneSectionResponse;
  timeZone: string | undefined;
  onAnnounce: (outcome: Outcome) => void;
}): JSX.Element {
  const revoke = useRevokePhone();
  // At phone width the five columns overflow 343 px (D136: never sideways): the app version moves
  // under the phone's name, the last-used time under its date, and Remove becomes an icon button
  // (its aria-label is the tooltip).
  const phone = useMediaQuery(MEDIA.phone);
  const [confirming, setConfirming] = useState<PhoneDeviceDto | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const cancel = (): void => {
    const id = confirming?.id;
    setConfirming(null);
    // Back to the row's Remove button.
    requestAnimationFrame(() =>
      tableRef.current
        ?.querySelector<HTMLButtonElement>(`[data-device="${id ?? ''}"]`)
        ?.focus({ preventScroll: true }),
    );
  };

  const confirm = (): void => {
    if (!confirming) return;
    const device = confirming;
    revoke.mutate(device.id, {
      onSuccess: () => {
        setConfirming(null);
        onAnnounce({ kind: 'done', text: removedText(device.label) });
        // The row is gone: the focus goes to the list's heading, not to <body>.
        requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: false }));
      },
      onError: (error) =>
        onAnnounce({ kind: 'error', title: 'Not removed', text: errorMessage(error) }),
    });
  };

  const columns = useMemo<ColumnTableColumn<PhoneDeviceDto>[]>(() => {
    const all: ColumnTableColumn<PhoneDeviceDto>[] = [
      phone
        ? {
            id: 'label',
            header: 'Phone',
            value: (d) => d.label,
            minWidth: 80,
            cell: (d) => (
              <span className="jf-app-phone-label">
                {d.label}
                <span className="jf-app-phone-label__app">{appVersionText(d)}</span>
              </span>
            ),
          }
        : { id: 'label', header: 'Phone', value: (d) => d.label },
      {
        id: 'paired',
        header: 'Paired',
        value: (d) => d.pairedAt,
        cell: (d) => <span className="jf-app-phone-time">{pairedDate(d.pairedAt, timeZone)}</span>,
      },
      {
        id: 'used',
        header: 'Last used',
        value: (d) => d.lastUsedAt,
        cell: (d) => {
          const text = lastUsedText(d.lastUsedAt, timeZone);
          const space = text.indexOf(' ');
          // At phone width the time goes under the date (the column then fits the date).
          return phone && d.lastUsedAt !== null && space > 0 ? (
            <span className="jf-app-phone-time jf-app-phone-time--split">
              <span>{text.slice(0, space)}</span>
              <span>{text.slice(space + 1)}</span>
            </span>
          ) : (
            <span className="jf-app-phone-time">{text}</span>
          );
        },
      },
      { id: 'app', header: 'App', value: (d) => appVersionText(d) },
      {
        id: 'remove',
        header: 'Remove',
        value: () => null,
        cell: (d) => (
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            data-device={d.id}
            aria-label={`Remove ${d.label}`}
            aria-expanded={confirming?.id === d.id}
            disabled={revoke.isPending}
            onClick={() => setConfirming(d)}
          >
            {phone ? undefined : 'Remove'}
          </Button>
        ),
      },
    ];
    return phone ? all.filter((c) => c.id !== 'app') : all;
  }, [timeZone, confirming, revoke.isPending, phone]);

  return (
    <div className="jf-app-block jf-app-phone-list" data-testid="phone-paired">
      <h3 id={PAIRED_TITLE_ID} ref={titleRef} tabIndex={-1} className="jf-app-subhead__title">
        {PAIRED_PHONES_TITLE}
      </h3>
      {data.devices.length === 0 ? (
        <p data-testid="phone-none">{NO_PHONE_TEXT}</p>
      ) : (
        <div ref={tableRef}>
          <ColumnTable
            caption={PAIRED_PHONES_TITLE}
            columns={columns}
            rows={data.devices}
            getRowId={(d) => d.id}
          />
        </div>
      )}
      {confirming ? (
        <div className="jf-app-phone-confirm">
          <DeleteConfirm
            question={removeQuestion(confirming.label)}
            label={`phone ${confirming.label}`}
            confirmLabel="Remove"
            busy={revoke.isPending}
            onConfirm={confirm}
            onCancel={cancel}
          />
        </div>
      ) : null}
      {data.removed.length > 0 ? (
        <details className="jf-app-details jf-app-phone-removed" data-testid="phone-removed">
          <summary className="jf-app-details__summary">
            {REMOVED_PHONES_TITLE} ({data.removed.length})
          </summary>
          <ColumnTable
            caption="Removed phones"
            columns={[
              { id: 'label', header: 'Phone', value: (d: PhoneDeviceDto) => d.label },
              {
                id: 'removed',
                header: 'Removed',
                value: (d: PhoneDeviceDto) => d.revokedAt,
                cell: (d: PhoneDeviceDto) => (
                  <span className="jf-app-phone-time">
                    {d.revokedAt ? pairedDate(d.revokedAt, timeZone) : '—'}
                  </span>
                ),
              },
            ]}
            rows={data.removed}
            getRowId={(d) => d.id}
          />
        </details>
      ) : null}
    </div>
  );
}

function AddressNote({ url }: { url: string }): JSX.Element {
  const note = addressNote(url);
  if (note.tone === 'important') {
    return (
      <Callout kind="important" title={note.title}>
        <p>{note.text}</p>
      </Callout>
    );
  }
  return (
    <p className="jf-app-meta jf-app-phone-note" data-testid="phone-address-note">
      {note.text}
    </p>
  );
}

function PairingBlock({
  pairing,
  now,
  address,
  onAddress,
  onNewCode,
  onCancel,
  busy,
}: {
  pairing: PhonePairingDto;
  now: number;
  address: string;
  onAddress: (value: string) => void;
  onNewCode: () => void;
  onCancel: () => void;
  busy: boolean;
}): JSX.Element {
  const normalised = normaliseServerUrl(address);
  const groupRef = useRef<HTMLDivElement>(null);
  // A new block takes the focus, so a keyboard user lands on the code (not on <body>).
  useEffect(() => {
    groupRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={groupRef}
      tabIndex={-1}
      className="jf-app-phone-pairing"
      role="group"
      aria-labelledby={PAIR_TITLE_ID}
      data-testid="phone-pairing"
    >
      <div className="jf-app-phone-pairing__qr">
        {normalised.ok ? (
          <PairingQr payload={pairingUrl(normalised.url, pairing.code)} />
        ) : (
          <div className="jf-app-phone-qr-missing" data-testid="phone-qr-missing">
            Enter a valid address to show the QR code.
          </div>
        )}
        <p className="jf-app-meta jf-app-phone-note">{QR_CAPTION}</p>
      </div>
      <div className="jf-app-phone-pairing__details">
        <TextField
          label={ADDRESS_LABEL}
          name="phone-address"
          type="url"
          autoComplete="off"
          value={address}
          onChange={onAddress}
          error={normalised.ok ? undefined : ADDRESS_ERROR}
        />
        {normalised.ok ? <AddressNote url={normalised.url} /> : null}
        <div className="jf-app-phone-code">
          <span className="jf-app-phone-code__label">{CODE_LABEL}</span>
          <span className="jf-app-phone-code__value" data-testid="phone-code">
            {formatPairingCode(pairing.code)}
          </span>
          <span className="jf-app-phone-code__left" data-testid="phone-countdown">
            {countdownText(msLeft(pairing, now))}
          </span>
        </div>
        <div className="jf-app-phone-actions">
          <Button variant="secondary" icon={RefreshCw} disabled={busy} onClick={onNewCode}>
            {NEW_CODE_BUTTON}
          </Button>
          <Button variant="ghost" icon={X} disabled={busy} onClick={onCancel}>
            {CANCEL_BUTTON}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PairPhone({
  data,
  onAnnounce,
}: {
  data: PhoneSectionResponse;
  onAnnounce: (outcome: Outcome | null) => void;
}): JSX.Element {
  const open = useOpenPairing();
  const cancel = useCancelPairing();
  const queryClient = useQueryClient();
  const [address, setAddress] = useState(() => defaultAddress(window.location.origin));
  /** The last code this page showed (to say why it closed). */
  const [shown, setShown] = useState<PhonePairingDto | null>(data.pairing);
  const now = useNow(data.pairing !== null);
  const pairButton = useRef<HTMLDivElement>(null);
  /** Set by Cancel: the focus goes back to "Pair a phone" once it is shown and enabled again. */
  const refocusPair = useRef(false);
  const isOpen = data.pairing !== null && msLeft(data.pairing, now) > 0;

  // A new code (or a replacement from another tab) becomes the one shown (state from props).
  if (
    data.pairing &&
    (shown?.code !== data.pairing.code || shown.createdAt !== data.pairing.createdAt)
  ) {
    setShown(data.pairing);
  }

  // The countdown ran out before the poll saw it: ask the server now.
  const expiredLocally = data.pairing !== null && !isOpen;
  useEffect(() => {
    if (expiredLocally) void queryClient.invalidateQueries({ queryKey: queryKeys.phone });
  }, [expiredLocally, queryClient]);

  const limit = atLimit(data);
  const unwritable = data.storeProblem === 'unwritable';
  const unavailable = limit || unwritable;
  const busy = open.isPending || cancel.isPending;

  // After Cancel: the button is focused only once the render shows it enabled (a frame callback
  // could run while it is still disabled by the pending cancel, and the focus would be lost).
  useEffect(() => {
    if (!refocusPair.current || isOpen || busy) return;
    if (unavailable) {
      refocusPair.current = false;
      return;
    }
    const button = pairButton.current?.querySelector('button');
    if (button && !button.disabled) {
      refocusPair.current = false;
      button.focus();
    }
  });

  const openCode = (): void => {
    onAnnounce(null);
    open.mutate(undefined, {
      onError: (error) =>
        onAnnounce({ kind: 'error', title: 'No code', text: errorMessage(error) }),
    });
  };
  const cancelCode = (): void => {
    cancel.mutate(undefined, {
      onSuccess: () => {
        setShown(null);
        refocusPair.current = true;
      },
      onError: (error) =>
        onAnnounce({ kind: 'error', title: 'Not cancelled', text: errorMessage(error) }),
    });
  };

  const reason = !isOpen && shown ? closedReason(shown, data, now) : null;
  // The note is the owner's signal of a new pairing: never for a phone removed since.
  const lastPaired = data.lastPaired;
  const lastPairedActive = lastPaired !== null && data.devices.some((d) => d.id === lastPaired.id);
  const failures =
    !isOpen &&
    data.lastCancelled?.reason === 'failures' &&
    (data.lastPaired === null ||
      Date.parse(data.lastCancelled.at) > Date.parse(data.lastPaired.pairedAt));

  return (
    <div className="jf-app-block jf-app-phone-pair" data-testid="phone-pair">
      <h3 id={PAIR_TITLE_ID} className="jf-app-subhead__title">
        {PAIR_TITLE}
      </h3>
      <LiveRegion kind="status" label="Pairing result">
        {!isOpen && lastPairedActive ? (
          <Callout kind="note" title="Paired">
            <p>{pairedText(lastPaired.label)}</p>
          </Callout>
        ) : null}
        {failures ? (
          <Callout kind="important" title={FAILURES_TITLE}>
            <p>{FAILURES_TEXT}</p>
          </Callout>
        ) : null}
        {reason === 'expired' ? (
          <p className="jf-app-phone-expired" data-testid="phone-expired">
            {EXPIRED_TEXT}
          </p>
        ) : null}
      </LiveRegion>
      {isOpen && data.pairing ? (
        <PairingBlock
          pairing={data.pairing}
          now={now}
          address={address}
          onAddress={setAddress}
          onNewCode={openCode}
          onCancel={cancelCode}
          busy={busy}
        />
      ) : (
        <div className="jf-app-phone-actions" ref={pairButton}>
          <Button
            variant="secondary"
            icon={QrCode}
            disabled={unavailable || busy}
            aria-busy={open.isPending || undefined}
            aria-describedby={unavailable ? PAIR_REASON_ID : undefined}
            onClick={openCode}
          >
            {PAIR_BUTTON}
          </Button>
          {unavailable ? (
            <span id={PAIR_REASON_ID} className="jf-app-meta">
              {limit ? limitText(data.maxDevices) : UNWRITABLE_TITLE}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PhoneBody({
  data,
  timeZone,
}: {
  data: PhoneSectionResponse;
  timeZone: string | undefined;
}): JSX.Element {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  return (
    <>
      <StoreProblem data={data} />
      <LiveRegion kind="status" label="Phone result">
        {outcome?.kind === 'done' ? (
          <p className="jf-app-phone-done" data-testid="phone-done">
            {outcome.text}
          </p>
        ) : outcome?.kind === 'error' ? (
          <Callout kind="do-not" title={outcome.title}>
            <p>{outcome.text}</p>
          </Callout>
        ) : null}
      </LiveRegion>
      <PairedPhones data={data} timeZone={timeZone} onAnnounce={setOutcome} />
      <PairPhone data={data} onAnnounce={setOutcome} />
    </>
  );
}

export function PhoneSection({
  query,
  timeZone,
}: {
  query: UseQueryResult<PhoneSectionResponse>;
  /** The server's zone (from Backups); undefined until it loads (the browser's zone is used). */
  timeZone: string | undefined;
}): JSX.Element {
  return (
    <section className="jf-app-block jf-app-phone" aria-labelledby={PHONE_SECTION_ID}>
      <SectionBar id={PHONE_SECTION_ID} title="Phone" role="reference" />
      <p className="jf-app-phone-lead">{PHONE_LEAD}</p>
      <QueryStates
        query={query}
        loading="Loading phones…"
        layout="table"
        errorTitle="Could not load the paired phones"
      />
      {query.data ? <PhoneBody data={query.data} timeZone={timeZone} /> : null}
    </section>
  );
}
