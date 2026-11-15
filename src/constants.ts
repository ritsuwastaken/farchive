export const packageTag = 0x9e2a83c1;
export const guidSize = 16;
export const maxIndex = 0x7fffffff;

export const compactIndex = {
  maxSize: 5,
  negative: 0x80,
  firstHasMore: 0x40,
  firstBits: 6,
  firstMask: 0x3f,
  hasMore: 0x80,
  bits: 7,
  mask: 0x7f,
} as const;
