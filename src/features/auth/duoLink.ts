/** Duo device verification is an app handoff, not a web page or an OAuth callback. */
export function isDuoScheme(value: string): boolean {
  return /^duotrustedendpoints:/i.test(value);
}

export function isDuoAppLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'duotrustedendpoints:' && url.hostname === 'duo.com' &&
      url.pathname === '/trusted_ep' && !url.username && !url.password && !url.port && !url.hash;
  } catch {
    return false;
  }
}
