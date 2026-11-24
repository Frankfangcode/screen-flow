'use strict';

// Short, obvious slurs and profanity. Mild Taiwanese fillers such as 靠北 are
// omitted on purpose — they show up in ordinary speech and the host can add
// them. Matching is case-insensitive, ignores spaces and common punctuation,
// and folds fullwidth letters (ｆｕｃｋ → fuck).
const DEFAULT_WORDS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'motherfucker',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'slut',
  'whore',
  'dickhead',
  'stfu',
  'wtf',
  '他媽的',
  '幹你娘',
  '幹你',
  '操你',
  '操你媽',
  '操你妈',
  '王八蛋',
  '婊子',
  '機掰',
  '雞掰',
  '白痴',
  '智障',
  '死全家',
  '傻逼',
  '傻屄',
  '性交',
  '做愛',
  '三小',
];

const STRIP = /[\s\u200b-\u200d\ufeff._\-*~#，。、！？!?,.'"“”‘’、·・]+/g;

function fold(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(STRIP, '');
}

function isBlocked(text, words) {
  const hay = fold(text);
  if (!hay) return false;
  for (const raw of words || []) {
    const needle = fold(raw);
    if (needle && hay.includes(needle)) return true;
  }
  return false;
}

function sanitizeWordList(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const w = String(item || '').trim();
    if (!w || w.length > 40) continue;
    const key = fold(w);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= 200) break;
  }
  return out;
}

module.exports = { DEFAULT_WORDS, isBlocked, sanitizeWordList, fold };
