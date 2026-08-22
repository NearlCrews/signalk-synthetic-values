import type { FormatRelativeAgeOptions } from 'signalk-nearlcrews-ui';

/**
 * Shared wording for every formatRelativeAge call in the panel. The library
 * default is narrow and always numeric, which renders a fresh poll as
 * "0 sec. ago"; the family convention is words. One constant so separate call
 * sites cannot drift into two wordings.
 *
 * The locale is pinned rather than following the host: every other string in
 * this panel is English, so an age that followed a Spanish browser would read
 * "last checked hace 5 minutos". It also keeps the browser assertions
 * independent of the runner's locale.
 */
export const RELATIVE_AGE_FORMAT: FormatRelativeAgeOptions = {
  fallback: 'just now',
  locale: 'en',
  numeric: 'auto',
  style: 'long',
};
