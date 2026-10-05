// Split view: a project's tabs (its Claude session first, then Run-menu tasks and terminals) in one zone,
// or in two zones stacked top (0) and bottom (1). Pure state helpers; the renderer owns the DOM.
// Loaded by the renderer as a plain <script> (window.WidgetZones) and by tests via require.
(function (root) {
  // Per project: { split, zone: { [tabId]: 1 } for tabs in the bottom zone, front: [top, bottom], focus: 0 | 1 }
  const initial = () => ({ split: false, zone: {}, front: [null, null], focus: 0 });

  const zoneOf = (st, id) => (st.split && st.zone[id] === 1 ? 1 : 0);

  // tabIds in display order -> { split, zones: [[ids], [ids]], front: [id | null, id | null], focus, focused }.
  // A split with an empty zone shows as one zone, so closing the last tab of a zone merges them back.
  function layout(st, tabIds) {
    let zones = [[], []];
    for (const id of tabIds) zones[zoneOf(st, id)].push(id);
    const split = st.split && zones[0].length > 0 && zones[1].length > 0;
    if (!split) zones = [tabIds.slice(), []];
    const front = zones.map((z, i) => (z.includes(st.front[i]) ? st.front[i] : z[0] ?? null));
    // Unsplit, the top zone shows whichever tab was focused last, even if it came from the bottom.
    if (!split && st.focus === 1 && tabIds.includes(st.front[1])) front[0] = st.front[1];
    const focus = split ? st.focus : 0;
    return { split, zones, front, focus, focused: front[focus] };
  }

  // Shows id in front of its zone and focuses that zone.
  function show(st, tabIds, id) {
    const z = layout(st, tabIds).split ? zoneOf(st, id) : 0;
    const next = { ...st, front: st.front.slice(), focus: z };
    next.front[z] = id;
    if (!next.split) next.front[0] = id;
    return next;
  }

  // Moves a tab to a zone (splitting if needed) and puts it in front there.
  function moveTo(st, tabIds, id, zone) {
    const cur = layout(st, tabIds);
    const next = { split: true, zone: { ...st.zone }, front: cur.front.slice(), focus: zone };
    if (zone === 1) next.zone[id] = 1;
    else delete next.zone[id];
    next.front[zone] = id;
    // The tab left the other zone: show another one there.
    const other = 1 - zone;
    if (next.front[other] === id) next.front[other] = null;
    return normalize(next, tabIds);
  }

  // A split whose zone emptied (tab moved or closed) goes back to one zone.
  function normalize(st, tabIds) {
    const bottom = tabIds.filter((id) => st.zone[id] === 1);
    if (!st.split || (bottom.length && bottom.length < tabIds.length)) return st;
    const front = layout(st, tabIds).front;
    return { split: false, zone: {}, front: [st.focus === 1 && bottom.includes(st.front[1]) ? st.front[1] : front[0], null], focus: 0 };
  }

  // Split on: the tab to move to the bottom zone (the focused one unless it is the Claude session, else the
  // newest other tab), or null when there is only the Claude session (open a new terminal below instead).
  function splitCandidate(st, tabIds) {
    const { focused } = layout(st, tabIds);
    if (focused && focused !== tabIds[0]) return focused;
    return tabIds.length > 1 ? tabIds[tabIds.length - 1] : null;
  }

  function unsplit(st, tabIds) {
    const { focused } = layout(st, tabIds);
    return { split: false, zone: {}, front: [focused, null], focus: 0 };
  }

  const api = { initial, layout, show, moveTo, normalize, splitCandidate, unsplit };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WidgetZones = api;
})(this);
