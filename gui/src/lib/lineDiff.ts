/** 代码块行级 Diff：计算修改后代码中"发生变化的行号"（1-based），供编辑器行内高亮 */

/** 行数上限：超过则退化为前缀/后缀剔除法（中间整块视为变化），避免 O(n²) 卡顿 */
const LCS_LINE_CAP = 1500;

/**
 * LCS 行级对比，返回 modified 中发生变化的行号（1-based）。
 * original 中被删除的行无法在 modified 中定位，不返回。
 */
export function diffChangedLines(original: string, modified: string): number[] {
  if (original === modified) return [];
  const a = original.split('\n');
  const b = modified.split('\n');

  // 超大输入：剔除公共前后缀，中间部分全部标记
  if (a.length > LCS_LINE_CAP || b.length > LCS_LINE_CAP) {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const changed: number[] = [];
    for (let i = p; i < b.length - s; i++) changed.push(i + 1);
    return changed;
  }

  // 标准 LCS DP
  const m = a.length;
  const n = b.length;
  // dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // 回溯：b 的行未被匹配 → 该行是新增/修改行
  const changed: number[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      changed.push(j + 1);
      j++;
    }
  }
  while (j < n) {
    changed.push(j + 1);
    j++;
  }
  return changed;
}

/**
 * 计算编辑器应高亮的绝对行号：修改块替换发生在文件 offsetInFile 处，
 * 修改块前有 startLine = offset 前的换行数行，加上 modified 内的相对变化行号。
 */
export function modHighlightLines(originalCode: string, modifiedCode: string, offsetInFile: number, fileContent: string): number[] {
  if (offsetInFile < 0) return [];
  const startLine = fileContent.slice(0, offsetInFile).split('\n').length - 1;
  return diffChangedLines(originalCode, modifiedCode).map((l) => startLine + l);
}
