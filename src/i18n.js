// ClaimTape i18n — CN / EN
//
// CT-1 note: the headline metric is EVIDENCE COVERAGE, never "trust".
// Coverage measures how much of a claim is backed by the evidence you supplied.
// It says nothing about whether the claim is true. Any string that implies a
// truth verdict is a bug — see the `disclaimer` keys below, which are shown
// permanently and must not be collapsible.

export const i18n = {
  en: {
    appName: 'ClaimTape',
    tagline: 'Which sentence should you check first?',
    subtitle: 'Paste an AI answer and your evidence. Get a claim-by-claim review queue. No API key. Runs locally.',
    inputLabel: 'AI Answer',
    inputPlaceholder: 'Paste the AI-generated text here…',
    evidenceLabel: 'Evidence (optional)',
    evidencePlaceholder: 'Paste logs / JSONL / test output / source text…\n\nSupports: plain text, JSONL, Markdown',
    uploadBtn: 'Upload file (.jsonl / .md / .txt)',
    analyzeBtn: 'Analyze',
    demoBtn: 'Try Demo',
    clearBtn: 'Clear',
    analyzing: 'Analyzing…',

    // ── CT-1: Evidence Coverage, not Trust Score ──
    coverageScore: 'Evidence Coverage',
    coverageScoreDesc: 'Share of claims backed by the evidence you supplied',
    disclaimer: 'Coverage measures evidence match, not truth. Click any claim to see what it was matched against.',
    disclaimerShort: 'Evidence match — not a truth verdict.',

    totalClaims: 'Total Claims',
    supported: 'Evidence found',
    unsupported: 'No evidence',
    contradicted: 'Possible conflict',
    needsHuman: 'Verify manually',

    copyMarkdown: 'Copy Markdown Report',
    exportJSON: 'Export JSON',
    shareLink: 'Copy share link',
    copied: 'Copied!',
    downloaded: 'Downloaded!',
    claimsTitle: 'Claim Analysis',
    riskTitle: 'Risk Flags',
    noRisks: 'No high-risk patterns detected.',

    // ── CT-1: no-evidence path produces no score at all ──
    noEvidenceTitle: 'No evidence provided',
    noEvidenceBody: 'Without evidence there is nothing to measure coverage against, so no score is shown. Claims below are labelled by type only — what kind of statement each one is, not whether it is true.',
    noEvidenceCta: 'Add evidence',
    evidenceNote: 'Evidence provided — matching claims against it…',

    badge: {
      supported: '✅ Evidence found',
      opinion: '💭 Opinion',
      assessment: '🧭 Assessment',
      unverified: '⚠️ No evidence',
      unsupported: '⚠️ No evidence',
      contradicted: '❌ Possible conflict',
      needs_human: '🔍 Verify manually',
      no_evidence: '⚪ No evidence provided',
    },
    badgeTooltip: {
      supported: 'Matching evidence was found. Click to see the exact passage — the match may still be wrong.',
      unsupported: 'Nothing in the supplied evidence matches this claim. That does not make it false.',
      contradicted: 'The evidence appears to conflict with this claim. Check it yourself first.',
      needs_human: 'Contains specific values (numbers, paths, commands) that a human should confirm.',
      no_evidence: 'No evidence was supplied, so this claim could not be checked at all.',
    },
    conflictReason: {
      polarity: 'Negation mismatch',
      numeric: 'Number mismatch',
    },
    riskPatterns: {
      bold_success: '"Tests pass" / "no bugs" without evidence',
      perfect_number: 'Claims 100% success rate',
      already_deployed: 'Claims something is already deployed/done',
      no_issues: 'Claims no issues/errors found',
      will_work: 'Overly confident "will work" / "guaranteed"',
      absolute_all: 'Absolute language: every/all/any/fully done',
      future_certainty: 'Certainty about the future',
    },
    coverageLabel: {
      high: 'Mostly backed',
      medium: 'Partly backed',
      low: 'Thinly backed',
      verylow: 'Barely backed',
    },
    reviewQueue: 'Review queue',
    reviewQueueDesc: 'Check these first',
    evidencePanel: 'Evidence',
    evidencePanelHint: 'Click a claim to highlight what it matched.',
    jumpToEvidence: 'Show in evidence',
    noHighlight: 'This claim matched nothing in the evidence.',

    semanticToggle: 'Local semantic pairing (optional)',
    semanticNote: 'Improves paraphrase matching only — which passage is highlighted. Never changes badges or Evidence Coverage. Enabling this downloads a small model to this browser on first use; it is the only network request in the suite. Off by default. If the model is missing, pairing falls back to lexical matching.',
    semanticStatusOn: 'Pairing: local semantic (highlights only)',
    semanticStatusOff: 'Pairing: lexical',
    semanticStatusFallback: 'Pairing: lexical (model unavailable)',
    semanticStatusLoading: 'Loading local pairing model\u2026',

    privacyNote: '🔒 All analysis runs locally in your browser. Nothing is sent to any server. The optional semantic toggle is the only feature that ever downloads a file, and only if you turn it on.',
    footer: 'MIT License · Open Source · Part of the Aurora Evidence Suite',
    demoNote: 'Demo: an Aurora Orchestra project summary (a slightly overclaiming AI answer + the real trace evidence)',
    whoItsFor: 'For: Students · Product Managers · Developers · Parents checking homework AI',
    howItWorks: 'How it works',
    how1: 'Paste any AI-generated answer',
    how2: 'Paste or upload the evidence it should be checked against',
    how3: 'Get a review queue: which claims to check first, and against what',
    how4: 'Copy a shareable Markdown report',
    claimNumber: 'Claim',
    evidenceMatches: 'Evidence matches:',
    noEvidenceMatches: 'No evidence keywords matched',
    conflictMatches: 'Conflict signals:',
    cmdPalette: 'Command palette',
    nextWarning: 'Next flagged claim',
    theme: 'Theme',
  },

  zh: {
    appName: 'ClaimTape',
    tagline: '这段回答，你该先核对哪一句？',
    subtitle: '粘贴 AI 回答和你的证据，得到一份逐条的人工复核清单。无需 API 密钥，本地运行。',
    inputLabel: 'AI 回答',
    inputPlaceholder: '在这里粘贴 AI 生成的文本…',
    evidenceLabel: '证据（可选）',
    evidencePlaceholder: '在这里粘贴追踪日志、测试输出、文件列表或任何支持文本…\n\n支持：纯文本、JSONL、Markdown',
    uploadBtn: '上传文件（.jsonl / .md / .txt）',
    analyzeBtn: '开始分析',
    demoBtn: '查看示例',
    clearBtn: '清空',
    analyzing: '分析中…',

    coverageScore: '证据覆盖率',
    coverageScoreDesc: '在你提供的证据中能找到支撑的声明占比',
    disclaimer: '覆盖率衡量的是证据匹配程度，不是事实正确性。点击每条声明查看它匹配到了什么。',
    disclaimerShort: '这是证据匹配度，不是真伪判决。',

    totalClaims: '总声明数',
    supported: '找到证据',
    unsupported: '无证据',
    contradicted: '可能冲突',
    needsHuman: '需人工核实',

    copyMarkdown: '复制 Markdown 报告',
    exportJSON: '导出 JSON',
    shareLink: '复制分享链接',
    copied: '已复制！',
    downloaded: '已下载！',
    claimsTitle: '声明分析',
    riskTitle: '风险标记',
    noRisks: '未检测到高风险模式。',

    noEvidenceTitle: '未提供证据',
    noEvidenceBody: '没有证据就无从计算覆盖率，因此不显示分数。下面只标注每句话的类型——它是哪一类陈述，而不是它是否为真。',
    noEvidenceCta: '添加证据',
    evidenceNote: '已提供证据 — 正在逐条比对…',

    badge: {
      supported: '✅ 找到证据',
      opinion: '💭 意见建议',
      assessment: '🧭 评估判断',
      unverified: '⚠️ 无证据',
      unsupported: '⚠️ 无证据',
      contradicted: '❌ 可能冲突',
      needs_human: '🔍 需人工核实',
      no_evidence: '⚪ 未提供证据',
    },
    badgeTooltip: {
      supported: '在证据中找到了匹配内容。点击查看具体段落——匹配本身也可能是错的。',
      unsupported: '你提供的证据里没有能对应上这条声明的内容。这并不等于它是假的。',
      contradicted: '证据看起来与这条声明冲突。请你自己先核对一遍。',
      needs_human: '含有具体数值（数字、路径、命令），需要人工确认。',
      no_evidence: '没有提供证据，这条声明根本无从核对。',
    },
    conflictReason: {
      polarity: '肯定/否定不一致',
      numeric: '数值不一致',
    },
    riskPatterns: {
      bold_success: '声称"测试通过"/"无 bug"但无证据',
      perfect_number: '声称 100% 成功率',
      already_deployed: '声称某事已部署/已完成',
      no_issues: '声称未发现问题/错误',
      will_work: '过度自信地说"一定有效"/"保证"',
      absolute_all: '绝对化措辞：所有/任意/完全完成',
      future_certainty: '对未来的确定性断言',
    },
    coverageLabel: {
      high: '大部分有支撑',
      medium: '部分有支撑',
      low: '支撑较少',
      verylow: '几乎没有支撑',
    },
    reviewQueue: '复核队列',
    reviewQueueDesc: '建议优先核对这些',
    evidencePanel: '证据',
    evidencePanelHint: '点击左侧声明，这里会高亮它匹配到的内容。',
    jumpToEvidence: '在证据中查看',
    noHighlight: '这条声明在证据中没有匹配到任何内容。',

    semanticToggle: '本地语义配对（可选）',
    semanticNote: '只改善复述配对——高亮哪一段证据。绝不改徽章，也不改证据覆盖率。首次开启会把一个小模型下载到本浏览器缓存，这是整套工具里唯一会访问网络的步骤。默认关闭。模型不可用时自动退回词面匹配。',
    semanticStatusOn: '配对：本地语义（仅高亮）',
    semanticStatusOff: '配对：词面匹配',
    semanticStatusFallback: '配对：词面匹配（模型不可用）',
    semanticStatusLoading: '正在加载本地配对模型…',

    privacyNote: '🔒 所有分析均在您的浏览器本地运行，不会向任何服务器发送数据。可选的语义配对开关是唯一会下载文件的功能，而且只有你打开它才会发生。',
    footer: 'MIT 许可证 · 开源 · Aurora Evidence Suite 成员',
    demoNote: '示例：Aurora Orchestra 项目摘要（略有夸大的 AI 回答 + 真实追踪证据）',
    whoItsFor: '适用于：学生 · 产品经理 · 开发者 · 检查作业 AI 的家长',
    howItWorks: '工作原理',
    how1: '粘贴任何 AI 生成的回答',
    how2: '粘贴或上传用来核对它的证据',
    how3: '得到复核队列：先看哪几条、依据是什么',
    how4: '复制可分享的 Markdown 报告',
    claimNumber: '声明',
    evidenceMatches: '证据匹配：',
    noEvidenceMatches: '未匹配到证据关键词',
    conflictMatches: '冲突信号：',
    cmdPalette: '命令面板',
    nextWarning: '下一条待核声明',
    theme: '主题',
  },
};

export function t(lang, key) {
  const keys = key.split('.');
  let obj = i18n[lang] || i18n.en;
  for (const k of keys) {
    obj = obj?.[k];
    if (obj === undefined) {
      // fallback to en
      obj = i18n.en;
      for (const k2 of keys) obj = obj?.[k2];
      break;
    }
  }
  return obj ?? key;
}
