const os = require('os');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);

const URL_PATTERN = /https?:\/\/[^\s"'<>)]+/gi;

// Only these are ever rasterized/transcribed — anything else (html, a redirect page, a
// zip, ...) is a shape this pipeline has no handling for and should fail loudly rather
// than be silently skipped or mis-rasterized.
const CONTENT_TYPE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

// Microsoft Defender for Office 365's "Safe Links" — rewrites every link in inbound mail
// to route through a click-time scanning proxy; the real destination is a URL-encoded
// value in the wrapper's own `url` query parameter, not the link's own host. Confirmed
// real, not hypothetical (2026-09-14): AYA/ATOM's actual claim-notification emails' "File
// Attachments Link:" section arrives wrapped exactly this way — without unwrapping it, the
// allowlist check below only ever sees "apc01.safelinks.protection.outlook.com" and
// rejects every link, regardless of what allowedHosts contains. Region-prefixed
// (apc01/eur01/nam01/...) is the form actually seen; the bare-domain form is matched too
// since Microsoft's own docs describe both.
const SAFELINKS_HOST_PATTERN = /(^|\.)safelinks\.protection\.outlook\.com$/i;

function unwrapSafeLink(parsedUrl) {
  if (!SAFELINKS_HOST_PATTERN.test(parsedUrl.hostname)) return parsedUrl;
  const inner = parsedUrl.searchParams.get('url');
  if (!inner) return parsedUrl;
  try {
    return new URL(inner);
  } catch {
    return parsedUrl; // malformed inner url — fall through, the outer host will just fail the allowlist check below
  }
}

/**
 * Shared by both URL sources below: finds every http(s) URL in `text`, unwraps a Safe
 * Links redirect if that's what it is, keeps only ones whose (real) host is allowlisted,
 * and dedupes while preserving first-seen order. URL_PATTERN already stops at
 * `"`/`'`/`<`/`>`, which is what lets extractEmailBodyLinkedDocumentUrls below pull a
 * clean URL straight out of `href="https://...pdf"` HTML markup with no separate
 * HTML-specific pattern needed.
 */
function filterAllowedUrls(text, allowedHosts) {
  const found = text.match(URL_PATTERN) || [];
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  const seen = new Set();
  const urls = [];

  for (const raw of found) {
    let parsed;
    try {
      parsed = new URL(raw.replace(/[).,;]+$/, '')); // trailing punctuation caught by the regex
    } catch {
      continue;
    }
    parsed = unwrapSafeLink(parsed);
    const hostname = parsed.hostname.toLowerCase();
    if (!allowed.has(hostname) || seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    urls.push(parsed.href);
  }

  return urls;
}

/**
 * Pulls URLs out of a PDF's own text layer via pdftotext (poppler-utils — already a system
 * dependency here, rasterize.js uses pdftoppm from the same package). Deliberately not
 * sourced from the vision transcript: the PDFs this pipeline sees for this are digitally
 * generated (verified, not scans), so their links are exact, real text — reading them off
 * a rendered page image via the vision model would add a real risk of a single misread
 * character silently breaking the fetch, for no benefit.
 */
async function extractLinkedDocumentUrls(pdfBuffer, allowedHosts) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claim-recognition-links-'));
  const inputPath = path.join(tempDir, 'input.pdf');
  await fs.promises.writeFile(inputPath, pdfBuffer);

  let stdout;
  try {
    ({ stdout } = await execFileAsync('pdftotext', ['-layout', inputPath, '-']));
  } catch (error) {
    throw new Error(`pdftotext failed: ${(error.stderr || '').toString().trim() || error.message}`);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return filterAllowedUrls(stdout, allowedHosts);
}

/**
 * Same idea as extractLinkedDocumentUrls, but for a submission with no MIME attachments at
 * all — some real claim notifications only list a "File Attachments Link:" section in the
 * email body instead of embedding the documents (verified against a real sample). Unlike
 * the PDF case, no pdftotext step is needed — mailparser's HTML body is already text, so
 * this just runs the same allowlist filter directly on it. Used by
 * modules/email-intake/service.js, not claim-recognition itself — lives here so both URL
 * sources share one allowlist/fetch implementation instead of two drifting copies.
 */
function extractEmailBodyLinkedDocumentUrls(html, allowedHosts) {
  return filterAllowedUrls(html, allowedHosts);
}

/**
 * Fetches one allowlisted linked document. Caller is responsible for only ever passing a
 * URL whose host already passed extractLinkedDocumentUrls' allowlist check.
 */
async function fetchLinkedDocument(url, { timeoutMs, maxBytes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`linked document fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`linked document fetch failed (${response.status} ${response.statusText})`);
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  let ext = CONTENT_TYPE_EXTENSIONS[contentType];
  if (!ext) {
    // Azure Blob Storage (and similar object stores) commonly serves
    // application/octet-stream when a blob was uploaded without an explicit content-type
    // set — confirmed real (2026-09-14, AYA/ATOM's own claim storage: the header says
    // application/octet-stream, but the URL's own path ends ".pdf.pdf", matching exactly
    // what the source email called the file). The header carries no real signal here, so
    // fall back to the URL's own filename extension rather than reject a file that's
    // obviously the right type.
    const urlExt = path.extname(new URL(url).pathname).toLowerCase();
    ext = Object.entries(CONTENT_TYPE_EXTENSIONS).find(([, mappedExt]) => mappedExt === urlExt)?.[1];
  }
  if (!ext) {
    throw new Error(`linked document has unsupported content-type "${contentType || 'unknown'}"`);
  }

  const contentLength = parseInt(response.headers.get('content-length'), 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`linked document exceeds max size (${contentLength} > ${maxBytes} bytes)`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error(`linked document exceeds max size (${arrayBuffer.byteLength} > ${maxBytes} bytes)`);
  }

  return { buffer: Buffer.from(arrayBuffer), contentType, ext };
}

module.exports = { extractLinkedDocumentUrls, extractEmailBodyLinkedDocumentUrls, fetchLinkedDocument };
