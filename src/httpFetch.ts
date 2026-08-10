import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
]);

let tlsFallbackNoticeShown = false;

function isTlsVerificationError(error: unknown): boolean {
  if (!(error instanceof TypeError) || error.message !== 'fetch failed') {
    return false;
  }

  const cause = error.cause as NodeJS.ErrnoException | undefined;
  return cause?.code !== undefined && TLS_ERROR_CODES.has(cause.code);
}

async function fetchViaWindowsCurl(url: string): Promise<Response> {
  if (!tlsFallbackNoticeShown) {
    tlsFallbackNoticeShown = true;
    console.warn(
      '[http] Node no pudo verificar certificados TLS en este equipo; se usará curl.exe como respaldo (certificados de Windows).',
    );
  }

  try {
    const { stdout } = await execFileAsync(
      'curl.exe',
      ['-s', '-S', '-f', url],
      { maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    );

    return new Response(stdout, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`curl.exe falló al consultar ${url}: ${message}`);
  }
}

/**
 * fetch() con fallback a curl.exe en Windows cuando Node no confía en la cadena TLS
 * (común con antivirus o inspección HTTPS corporativa).
 */
export async function httpFetch(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;

  try {
    return await fetch(input, init);
  } catch (error) {
    if (process.platform === 'win32' && isTlsVerificationError(error)) {
      return fetchViaWindowsCurl(url);
    }
    throw error;
  }
}
