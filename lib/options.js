'use strict';

// Shared contract for the join page and the server. The join page also
// fetches GET /api/options so the two cannot drift.
module.exports = {
  maxLength: 50,
  msgIntervalMs: 3000,
  emojiIntervalMs: 1500,
  sizes: ['s', 'm', 'l'],
  colors: [
    '#FFFFFF',
    '#FFE14A',
    '#7CFFB2',
    '#7AD7FF',
    '#FF8AD4',
    '#FF6B4A',
    '#D4B5FF',
    '#C8F542',
  ],
  motions: ['scroll', 'top', 'bottom', 'float', 'bounce'],
  emojis: ['👍', '😂', '❤️', '🔥', '👏', '🤯'],
};
