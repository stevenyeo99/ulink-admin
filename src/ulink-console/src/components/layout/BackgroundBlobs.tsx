/**
 * Two large, low-opacity blurred brand-color blobs behind the whole app — an
 * Apple-marketing-page touch that reads as "brand warmth" without ever competing with the
 * canvas content on top of it. Purely decorative, aria-hidden, fixed so it never scrolls.
 */
export function BackgroundBlobs() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-ulink-teal/20 blur-[120px]" />
      <div className="absolute -bottom-48 -right-32 h-[36rem] w-[36rem] rounded-full bg-ulink-orange/20 blur-[130px]" />
    </div>
  );
}
