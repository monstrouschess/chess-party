// Code shared by the browser and the server.

// No O/0 or I/1 so codes are easy to read out loud.
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 5;

// Returns null while the game is still going, otherwise { winner: 'w'|'b'|null, reason }.
export function resultOf(chess) {
  if (chess.isCheckmate()) return { winner: chess.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' };
  if (chess.isStalemate()) return { winner: null, reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { winner: null, reason: 'insufficient material' };
  if (chess.isThreefoldRepetition()) return { winner: null, reason: 'repetition' };
  if (chess.isDrawByFiftyMoves()) return { winner: null, reason: '50-move rule' };
  return null;
}
