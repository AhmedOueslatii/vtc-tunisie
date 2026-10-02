import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TripMap } from '@/components/trip-map';
import { Badge, Card, Field, PageHeader, tripStatusTone } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDt, formatKm, formatNumber } from '@/lib/format';
import { getT } from '@/lib/i18n';
import { formatDate, labelOf } from '@/lib/intl';
import { type Person, type TripDetail, type TripTrack, UUID } from '@/lib/types';

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { locale, t } = await getT();

  let trip: TripDetail;
  let track: TripTrack = { points: [], travelledDistanceM: 0 };
  try {
    [trip, track] = await Promise.all([
      api<TripDetail>(`/admin/trips/${id}`),
      // La trace est un complément : sans elle (course sans position enregistrée) la fiche reste utile
      api<TripTrack>(`/admin/trips/${id}/track`).catch((e: unknown) => {
        if (e instanceof ApiError) return { points: [], travelledDistanceM: 0 };
        throw e;
      }),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const actorOf = (actorId: string | null) =>
    actorId === trip.passenger.id ? t('actor.passenger') : actorId && actorId === trip.driver?.id ? t('actor.driver') : t('actor.system');
  const person = (p: Person) => (
    <>
      {p.fullName ?? t('common.none')}
      <span className="block text-xs font-normal text-muted" dir="ltr">
        <span className="inline-block">{p.phone}</span>
      </span>
    </>
  );
  const ratingLabel = (raterId: string) =>
    raterId === trip.passenger.id ? t('rating.passengerToDriver') : t('rating.driverToPassenger');

  return (
    <>
      <Link href="/trips" className="mb-3 inline-block text-sm text-muted hover:underline">
        {t('common.back')}
      </Link>
      <PageHeader title={t('trip.title', { id: trip.id.slice(0, 8) })} subtitle={formatDate(trip.requestedAt, locale, true)}>
        <Badge tone={tripStatusTone(trip.status)}>{labelOf(locale, 'tripStatus', trip.status)}</Badge>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('trip.parties')}>
          <dl className="grid grid-cols-2 gap-4">
            <Field label={t('trip.passenger')}>{person(trip.passenger)}</Field>
            <Field label={t('trip.driver')}>
              {trip.driver ? (
                <>
                  {person(trip.driver)}
                  {trip.vehicle && (
                    <span className="block text-xs font-normal text-muted">
                      {trip.vehicle.make} {trip.vehicle.model} · <span dir="ltr" className="inline-block">{trip.vehicle.plate}</span>
                    </span>
                  )}
                </>
              ) : (
                <span className="font-normal text-muted">{t('trip.noDriver')}</span>
              )}
            </Field>
          </dl>
        </Card>

        <Card title={t('trip.payment')}>
          <dl className="grid grid-cols-2 gap-4">
            <Field label={t('trip.quotedPrice')}>{formatDt(trip.quotedPrice, locale)}</Field>
            <Field label={t('trip.finalPrice')}>{trip.finalPrice === null ? t('common.none') : formatDt(trip.finalPrice, locale)}</Field>
            {trip.cancellationFee !== null && trip.cancellationFee > 0 && (
              <Field label={t('trip.cancellationFee')}>{formatDt(trip.cancellationFee, locale)}</Field>
            )}
            <Field label={t('trip.paymentStatus')}>
              {trip.payment ? (
                <>
                  {labelOf(locale, 'paymentMethod', trip.payment.method)} · {labelOf(locale, 'paymentStatus', trip.payment.status)}
                </>
              ) : (
                <span className="font-normal text-muted">{t('trip.noPayment')}</span>
              )}
            </Field>
          </dl>
        </Card>
      </div>

      <Card title={t('trip.route')} className="mt-4">
        <dl className="mb-4 grid gap-4 sm:grid-cols-2">
          <Field label={t('trip.pickup')}>{trip.pickupAddress ?? t('common.none')}</Field>
          <Field label={t('trip.dropoff')}>{trip.dropoffAddress ?? t('common.none')}</Field>
          <Field label={t('trip.distance')}>{formatKm(trip.estimatedDistanceM, locale)}</Field>
          <Field label={t('trip.duration')}>
            {t('trip.minutes', { n: formatNumber(Math.round(trip.estimatedDurationS / 60), locale) })}
          </Field>
        </dl>
        <TripMap
          pickup={trip.pickup}
          dropoff={trip.dropoff}
          track={track.points}
          labels={{ pickup: t('trip.pickup'), dropoff: t('trip.dropoff'), aria: t('trip.mapAria') }}
        />
        <p className="mt-2 text-xs text-muted">
          {track.points.length > 0
            ? `${t('trip.map')} — ${t('trip.travelled', { distance: formatKm(track.travelledDistanceM, locale) })}`
            : t('trip.noTrack')}
        </p>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title={t('trip.timeline')}>
          <ol className="space-y-3">
            {trip.events.map((event) => (
              <li key={event.id} className="border-s-2 border-line ps-3">
                <p className="text-sm font-medium">{labelOf(locale, 'tripStatus', event.toStatus)}</p>
                <p className="text-xs text-muted">
                  {formatDate(event.at, locale, true)} · {actorOf(event.actorId)}
                </p>
                {event.meta?.reason && <p className="text-xs">{t('trip.reason', { reason: event.meta.reason })}</p>}
                {typeof event.meta?.fee === 'number' && event.meta.fee > 0 && (
                  <p className="text-xs">{t('trip.fee', { fee: formatDt(event.meta.fee, locale) })}</p>
                )}
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-4">
          <Card title={t('trip.offers')}>
            {trip.offers.length === 0 ? (
              <p className="text-sm text-muted">{t('trip.noOffers')}</p>
            ) : (
              <ul className="space-y-2">
                {trip.offers.map((offer) => (
                  <li key={offer.id} className="flex items-start justify-between gap-2 text-sm">
                    <span>
                      {offer.driver.fullName ?? offer.driver.phone}
                      <span className="block text-xs text-muted">{t('trip.offerDistance', { distance: formatNumber(offer.distanceM, locale) })}</span>
                    </span>
                    <Badge tone={offer.status === 'accepted' ? 'success' : 'neutral'}>{labelOf(locale, 'offerStatus', offer.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('trip.ratings')}>
            {trip.ratings.length === 0 ? (
              <p className="text-sm text-muted">{t('trip.noRatings')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {trip.ratings.map((rating) => (
                  <li key={rating.raterId}>
                    <span className="font-medium">{ratingLabel(rating.raterId)}</span> : {rating.score}/5
                    {rating.comment && <span className="block text-xs text-muted">{rating.comment}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('trip.tickets')}>
            {trip.tickets.length === 0 ? (
              <p className="text-sm text-muted">{t('trip.noTickets')}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {trip.tickets.map((ticket) => (
                  <li key={ticket.id} className="flex items-center justify-between gap-2">
                    <span>{labelOf(locale, 'ticketCategory', ticket.category)}</span>
                    <Badge>{labelOf(locale, 'ticketStatus', ticket.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
