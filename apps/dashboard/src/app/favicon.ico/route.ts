const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#111827"/><path d="M18 46V18h8v12l12-12h10L35 31l14 15H38L26 32v14z" fill="#ffffff"/></svg>`;

export function GET(): Response {
  return new Response(ICON, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
