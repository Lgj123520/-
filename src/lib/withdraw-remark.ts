/** 与上传解析一致：备注中含以下关键词视为退费/退班类，不计入续班有效人数，但可保留已上课时展示 */
const WITHDRAW_REMARK_KEYWORDS = [
  '退费',
  '试听',
  '休学',
  '退学',
  '退款',
  '取消',
  '退班',
  '退',
] as const;

export function isWithdrawalRemark(text: string | null | undefined): boolean {
  const t = String(text ?? '')
    .trim()
    .toLowerCase();
  if (!t) return false;
  return WITHDRAW_REMARK_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}
