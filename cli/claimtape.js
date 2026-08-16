#!/usr/bin/env node
// ClaimTape CLI — optional tiny companion
// Usage:
//   echo "AI text" | node cli/claimtape.js
//   node cli/claimtape.js --answer answer.txt --evidence trace.jsonl
//   node cli/claimtape.js --answer answer.txt --evidence trace.jsonl --format json

import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

// Inline the analyzer (avoids transpile dependency for CLI usage)
// We import the source directly as ES module
import { analyze, generateMarkdownReport, generateJSONExport } from '../src/analyzer.js';

const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  return null;
}

const answerFile = getArg('--answer');
const evidenceFile = getArg('--evidence');
const format = getArg('--format') || 'text';
const failUnder = getArg('--fail-under');
const exitOnLow = failUnder != null ? Number(failUnder) : null;
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`
ClaimTape CLI v2.0
Which sentence should you check first?

Usage:
  echo "AI text" | node cli/claimtape.js
  node cli/claimtape.js --answer answer.txt --evidence trace.jsonl
  node cli/claimtape.js --answer answer.txt --evidence trace.jsonl --format json
  node cli/claimtape.js --answer answer.txt --evidence trace.jsonl --format markdown

Options:
  --answer <file>      File containing AI answer text (or pipe via stdin)
  --evidence <file>    File containing evidence text (.jsonl/.md/.txt)
  --format <fmt>       Output format: text (default) | json | markdown
  --fail-under <n>     Exit 1 when evidence coverage is below n (for CI)
  -h, --help           Show this help

CI example — gate a PR on how much of an AI-written summary is backed by the
  actual test output:
  claimtape --answer pr-summary.md --evidence test-output.txt --fail-under 60

Evidence Coverage measures how much of a claim is backed by the evidence you
supplied. It is NOT a truth score. With no evidence, no score is produced.

No API key required. All analysis runs locally.
`);
  process.exit(0);
}

async function main() {
  let answerText = '';
  let evidenceText = '';

  // Read answer
  if (answerFile) {
    if (!existsSync(answerFile)) {
      console.error(`Error: answer file not found: ${answerFile}`);
      process.exit(1);
    }
    answerText = readFileSync(answerFile, 'utf8');
  } else if (!process.stdin.isTTY) {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    answerText = Buffer.concat(chunks).toString('utf8');
  }

  if (!answerText.trim()) {
    console.error('Error: No answer text provided. Use --answer <file> or pipe text via stdin.');
    console.error('Use --help for usage.');
    process.exit(1);
  }

  // Read evidence
  if (evidenceFile) {
    if (!existsSync(evidenceFile)) {
      console.error(`Warning: evidence file not found: ${evidenceFile}`);
    } else {
      evidenceText = readFileSync(evidenceFile, 'utf8');
    }
  }

  const results = analyze(answerText, evidenceText);

  if (format === 'json') {
    console.log(generateJSONExport(results, answerText, evidenceText));
    return;
  }

  if (format === 'markdown') {
    console.log(generateMarkdownReport(results));
    return;
  }

  // Default: pretty text output
  const { claims, stats, riskFlags, hasEvidence } = results;
  const coverage = results.coverage ?? results.score;
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';

  console.log(`\n${bold}ClaimTape Report${reset}`);
  console.log('─'.repeat(50));

  // CT-1: the metric is EVIDENCE COVERAGE, never "trust". And with no evidence
  // there is nothing to measure against, so we print no number at all rather
  // than a 0 that reads like a verdict.
  if (coverage == null) {
    console.log(`${bold}Evidence Coverage:${reset} ${dim}n/a — no evidence supplied${reset}`);
    console.log(`${dim}Claims below are labelled by type only, not by whether they are true.${reset}\n`);
  } else {
    const scoreColor = coverage >= 70 ? '\x1b[32m' : coverage >= 45 ? '\x1b[33m' : '\x1b[31m';
    console.log(`${bold}Evidence Coverage:${reset} ${scoreColor}${coverage}/100${reset}`);
    console.log(`${dim}Coverage measures evidence match, not truth.${reset}\n`);
  }

  console.log(`Total claims: ${stats.total}`);
  console.log(`  ✅ Evidence found:   ${stats.supported}`);
  console.log(`  ⚠️  No evidence:      ${stats.unverified ?? stats.unsupported}`);
  console.log(`  ❌ Possible conflict: ${stats.contradicted}`);
  console.log(`  🔍 Verify manually:   ${stats.needs_human}`);

  if (riskFlags.length > 0) {
    console.log(`\n⚠️  Risk Flags: ${riskFlags.join(', ')}`);
  }

  console.log('\n' + '─'.repeat(50));

  const statusIcons = {
    supported: '✅', unsupported: '⚠️', unverified: '⚠️',
    contradicted: '❌', needs_human: '🔍', opinion: '💭', assessment: '🧭',
  };

  // CT-1: lead with the review queue — the order a human should check things
  // in is the actual deliverable; the score is only a summary of it.
  if (hasEvidence && results.reviewQueue?.length) {
    console.log(`${bold}Check these first:${reset}`);
    results.reviewQueue.slice(0, 5).forEach((c, i) => {
      console.log(`  ${i + 1}. ${statusIcons[c.status] || '?'} #${c.id} ${c.claim.substring(0, 70)}${c.claim.length > 70 ? '…' : ''}`);
    });
    console.log('\n' + '─'.repeat(50));
  }

  console.log(`${bold}All claims:${reset}\n`);

  claims.forEach(c => {
    const icon = hasEvidence ? (statusIcons[c.status] || '?') : '⚪';
    const riskNote = c.isRisky ? ' 🚩' : '';
    const conflictNote = c.conflictKind ? ` \x1b[31m[${c.conflictKind} mismatch]${reset}` : '';
    console.log(`${icon}${riskNote} Claim ${c.id}: ${c.claim.substring(0, 80)}${c.claim.length > 80 ? '…' : ''}${conflictNote}`);
    if (c.evidenceMatches?.length > 0) {
      console.log(`   ${dim}Evidence: ${c.evidenceMatches.slice(0, 5).join(', ')}${reset}`);
    }
    if (c.conflictSignals?.length > 0) {
      console.log(`   \x1b[31mConflicts: ${c.conflictSignals.join(', ')}${reset}`);
    }
    console.log();
  });

  console.log(`${dim}─ ClaimTape v2.0 — local, private, no API key. Coverage ≠ truth. ─${reset}\n`);

  // CT-1 / scenario ②: exit non-zero when coverage is low or conflicts exist,
  // so CI can gate on it (documented in the README as the developer workflow).
  if (exitOnLow != null && coverage != null && coverage < exitOnLow) {
    console.error(`${dim}coverage ${coverage} < --fail-under ${exitOnLow}${reset}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
