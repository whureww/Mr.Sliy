/** 快速打开（Ctrl+P）的文件名模糊匹配：子序列匹配 + 连续/词首加分，返回 null 表示不匹配 */

/**
 * 计算 query 对 target 的模糊匹配得分。
 * 得分越高越靠前；不匹配返回 null。大小写不敏感。
 * 规则：子序列必须按序出现；连续命中 +5；命中词首（路径分隔符/点/大写词首）+3；
 * 首字符命中 +4；query 越短相对得分越高（除以 target 长度的缓和项）。
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (!t.includes(q)) {
    // 非连续包含：做子序列校验
    if (!isSubsequence(q, t)) return null;
  }
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return null;
    if (idx === prevMatch + 1) score += 5; // 连续命中
    if (idx === 0) score += 4; // 开头命中
    else if (isWordStart(target, idx)) score += 3; // 词首命中
    score += 1; // 基础分
    prevMatch = idx;
    ti = idx + 1;
  }
  // 短目标优先：命中位置越早越好
  score += Math.max(0, 8 - Math.floor(target.length / 8));
  return score;
}

function isSubsequence(q: string, t: string): boolean {
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}

function isWordStart(target: string, idx: number): boolean {
  if (idx === 0) return true;
  const prev = target[idx - 1];
  const cur = target[idx];
  if (prev === '/' || prev === '\\' || prev === '.' || prev === '-' || prev === '_' || prev === ' ') return true;
  // 驼峰词首：前小写后大写
  return /[a-z]/.test(prev) && /[A-Z]/.test(cur);
}
