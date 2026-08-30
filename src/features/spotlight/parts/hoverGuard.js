// Last real mouse position, shared across every ResultItem/MoreResultsRow
// instance — see the mouseenter guard in ResultItem.jsx for why this needs to
// live outside React state (it must survive remounts of individual rows as
// the list reflows). Pair with isRealPointerMove from utils/helpers.
export const lastPointerPos = { x: -1, y: -1 };
