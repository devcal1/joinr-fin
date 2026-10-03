// Settings → Phone (stage-9.md §4.1, §6.1–§6.2, FROZEN endpoints), behind the Umbrel login and the
// cross-site write guard; a device key is never accepted here. Every answer is the section:
//   GET    /api/phone                       200
//   POST   /api/phone/pairing               201 (a new code; any open code is replaced) · 409
//   DELETE /api/phone/pairing               200
//   POST   /api/phone/devices/:id/revoke    200 (idempotent; applied in memory first) · 400 · 404
// Only the open pairing code travels here (the web shows it); never a key or a key hash.
import { DEVICE_ID_RE, type PhoneSectionResponse } from '@joinr/schema';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError } from '../errors';
import type { DeviceStore } from '../mobile/devices';
import type { PairingService } from '../mobile/pairing';
import {
  BAD_DEVICE_ID_MESSAGE,
  EMPTY_BODY_MESSAGE,
  MobileError,
  UNKNOWN_DEVICE_MESSAGE,
} from '../mobile/sentences';
import { sendMobileError } from './mobile';

export interface PhoneRoutesOptions {
  store: DeviceStore;
  pairing: PairingService;
}

/** POST body: none, or an empty object. */
function assertEmptyBody(body: unknown): void {
  if (body === undefined || body === null || body === '') return;
  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) return;
  throw new HttpError(400, EMPTY_BODY_MESSAGE, 'VALIDATION_ERROR');
}

export const phoneRoutes: FastifyPluginAsync<PhoneRoutesOptions> = async (app, opts) => {
  const { store, pairing } = opts;

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/phone', async (): Promise<PhoneSectionResponse> => pairing.section());

  app.post('/phone/pairing', async (request, reply) => {
    assertEmptyBody(request.body);
    try {
      pairing.openCode();
    } catch (err) {
      if (err instanceof MobileError) return sendMobileError(reply, err);
      throw err;
    }
    return reply.code(201).send(pairing.section());
  });

  app.delete('/phone/pairing', async (): Promise<PhoneSectionResponse> => {
    pairing.cancel();
    return pairing.section();
  });

  app.post<{ Params: { id: string } }>(
    '/phone/devices/:id/revoke',
    async (request): Promise<PhoneSectionResponse> => {
      const { id } = request.params;
      if (typeof id !== 'string' || !DEVICE_ID_RE.test(id)) {
        throw new HttpError(400, BAD_DEVICE_ID_MESSAGE, 'VALIDATION_ERROR');
      }
      assertEmptyBody(request.body);
      if (store.revoke(id) === 'unknown') throw new HttpError(404, UNKNOWN_DEVICE_MESSAGE);
      return pairing.section();
    },
  );
};
