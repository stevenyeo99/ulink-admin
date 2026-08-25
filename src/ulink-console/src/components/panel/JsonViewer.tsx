// Lightweight JSON pretty-printer with token coloring — deliberately not pulling in a
// full syntax-highlighting dependency for what's just a read-only result viewer.
const TOKEN_PATTERN = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g;

// resultSummary/errorMessage can contain arbitrary text pulled from emails, attachment
// filenames, or LLM output — none of it trusted. Escape HTML metacharacters BEFORE
// wrapping tokens in <span>, so dangerouslySetInnerHTML below can never render markup
// that was actually just a JSON string's own content (e.g. a subject line containing
// "<img onerror=...>"). Deliberately not escaping quotes — they're JSON string
// delimiters the regex above matches on, and are inert as literal HTML text content.
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(json: string): string {
  return escapeHtml(json).replace(TOKEN_PATTERN, (match) => {
    let className = 'text-ulink-orange-dark'; // number
    if (/^"/.test(match)) {
      className = /:$/.test(match) ? 'text-slate-500' : 'text-ulink-teal-dark';
    } else if (/true|false/.test(match)) {
      className = 'text-purple-600';
    } else if (/null/.test(match)) {
      className = 'text-slate-400';
    }
    return `<span class="${className}">${match}</span>`;
  });
}

export function JsonViewer({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <p className="text-sm italic text-slate-400">No data</p>;
  }

  const json = JSON.stringify(value, null, 2);

  return (
    <pre
      className="max-h-[50vh] overflow-auto rounded-lg bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700"
      // highlight() HTML-escapes the JSON text before wrapping regex-matched tokens in
      // <span> (see escapeHtml above) — nothing here can render as markup.
      dangerouslySetInnerHTML={{ __html: highlight(json) }}
    />
  );
}
