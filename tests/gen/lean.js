// a lean spotify extended history of n plays across 2024 and 2025, for the
// performance tests. built in chunks so even two million plays fit.

const enc = new TextEncoder();

export function leanHistory(n) {
  const parts = [enc.encode('[')];
  const step = (Date.UTC(2026, 0, 1) - Date.UTC(2024, 0, 1)) / n;
  let batch = [];
  for (let i = 0; i < n; i++) {
    const end = Math.floor((Date.UTC(2024, 0, 1) + i * step) / 1000) * 1000 + 200000;
    batch.push(`{"ts":"${new Date(end).toISOString().replace('.000Z', 'Z')}","platform":"ios","ms_played":${30000 + (i % 170000)},"master_metadata_track_name":"track ${i % 40000}","master_metadata_album_artist_name":"artist ${i % 2500}","master_metadata_album_album_name":"album ${i % 7000}","reason_end":"${i % 9 ? 'trackdone' : 'fwdbtn'}","skipped":${i % 9 === 0},"shuffle":false}`);
    if (batch.length === 10000 || i === n - 1) {
      parts.push(enc.encode((i >= batch.length ? ',' : '') + batch.join(',')));
      batch = [];
    }
  }
  parts.push(enc.encode(']'));
  return parts;
}
