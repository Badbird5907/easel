import { useEffect, useMemo, useState } from 'react';

import type { Option } from '@/design';
import { motion } from '@/design/tokens/layout';
import { localizedZoneName } from '@/i18n/timeZones';
import { deviceTimeZone } from '@/lib/dates';

import { timeZoneName } from './timeZone';
import { canvasTimeZones } from './timeZones';

type ZoneOption = Option<string> & { searchText: string };
// Account-independent labels; a locale/device/selection change gets its own index.
const completed = new Map<string, ZoneOption[]>();
const empty: ZoneOption[] = [];
const knownZones = new Set(canvasTimeZones.map(([iana]) => iana));

/** Only mounted inside the open sheet. ICU work yields between small batches. */
export function useTimeZoneOptions(locale: string, timeZone: string, deviceLabel: string) {
  const source = useMemo(() => {
    const device = deviceTimeZone();
    const extras = [...new Set([timeZone, device])]
      .filter((iana) => !knownZones.has(iana))
      .map((iana) => [iana, timeZoneName(iana) ?? iana] as const);
    return { device, zones: [...extras, ...canvasTimeZones] };
  }, [timeZone]);
  const key = JSON.stringify([locale, timeZone, source.device, deviceLabel]);
  const cached = completed.get(key);
  const [result, setResult] = useState<{
    source: typeof source;
    locale: string;
    deviceLabel: string;
    options: ZoneOption[];
    complete: boolean;
  } | null>(null);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    let idle: ReturnType<typeof requestIdleCallback> | undefined;
    let index = 0;
    const options: ZoneOption[] = [];
    const build = () => {
      idle = requestIdleCallback(
        () => {
          if (cancelled) return;
          // Bound native formatter work even when the idle deadline is generous.
          const end = Math.min(index + 6, source.zones.length);
          for (; index < end; index++) {
            const [iana, canvasLabel] = source.zones[index];
            const label = localizedZoneName(iana, locale);
            options.push({
              value: iana,
              label: `${label} (${iana})`,
              subtitle: iana === source.device ? deviceLabel : undefined,
              searchText: `${canvasLabel}\n${label}\n${iana}`.toLowerCase(),
            });
          }
          const complete = index === source.zones.length;
          if (complete) completed.set(key, options);
          // Show a few rows first, then publish the full index once ready.
          if (index === 6 || complete)
            setResult({ source, locale, deviceLabel, options: [...options], complete });
          if (!complete) build();
        },
        { timeout: 100 },
      );
    };
    // Let the sheet's native fade and slide finish before formatting the list.
    const timer = setTimeout(build, motion.duration.slow);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (idle !== undefined) cancelIdleCallback(idle);
    };
  }, [source, locale, deviceLabel, key, cached]);

  if (cached) return { options: cached, complete: true };
  return result?.source === source && result.locale === locale && result.deviceLabel === deviceLabel
    ? result
    : { options: empty, complete: false };
}
