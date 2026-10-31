// hide names on a card. every card already carries its masked twin, built
// from the same templates with names left out, so this only swaps faces.

/**
 * @param {import('./cards.js').Card} card
 * @param {{ names?: boolean }} [opts]  names: true keeps them
 */
export function redact(card, opts = {}) {
  if (opts.names || !card.sensitive) return card;
  const m = card.masked;
  return {
    ...card,
    title: m.title,
    big: m.big,
    caption: m.caption,
    detail: m.detail,
    visual: m.visual,
    share: m.share,
    names: [],
    hidden: true,
  };
}

/** true if any of the card's names can still be read on it */
export function leaks(card, names) {
  const text = [card.title, card.big, card.caption, card.detail, card.share?.text,
    ...(card.visual?.items || []).flatMap(i => [i.label, i.sub])].filter(Boolean).join('\n');
  return names.some(n => n.length > 2 && text.includes(n));
}
