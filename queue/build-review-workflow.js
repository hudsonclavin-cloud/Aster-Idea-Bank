export const meta = {
  name: 'aster-idea-bank-build',
  description: 'Build, independently review, fix and re-verify a batch of Aster Idea Bank deposits (one folder each) under the house rules',
  phases: [
    { title: 'Build', detail: 'one builder per idea writes ideas/NN-slug and passes tools/check.mjs' },
    { title: 'Review', detail: 'an independent reviewer tries to prove each deposit wrong' },
    { title: 'Fix', detail: 'a fixer addresses every finding and re-runs the checker' },
    { title: 'Re-review', detail: 'a second review and fix only where the first review found blocking problems' },
  ],
}

const BANK = '/home/user/Aster-Idea-Bank'
const SCRATCH = '/home/user/Aster-Idea-Bank/queue'  // was the session scratchpad
const BUILDER_BRIEF = SCRATCH + '/BUILDER_BRIEF.md'
const REVIEWER_BRIEF = SCRATCH + '/REVIEWER_BRIEF.md'
const ideas = Array.isArray(args) ? args : (args && args.ideas) || []
if (!ideas.length) throw new Error('no ideas in args')

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['built', 'abandoned'] },
    folder: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    whatItDoes: { type: 'string', description: 'two or three sentences, exact' },
    testsPin: { type: 'string', description: 'which external references the tests pin numbers to, and what sabotage breaks how many tests' },
    checkOutput: { type: 'string', description: 'the last lines of node tools/check.mjs for the folder' },
    sizeKb: { type: 'number' },
    findingsAboutSourceRepo: { type: 'string', description: 'defects, stale numbers or gaps found in Aster/PartForge/Skyhook while building, with file:line; or none' },
    deviationsFromProposal: { type: 'string', description: 'what you changed from the judged proposal and why' },
    notBuilt: { type: 'string', description: 'what you could not build or prove, honestly; or none' },
  },
  required: ['status', 'folder', 'files', 'whatItDoes', 'testsPin', 'checkOutput', 'sizeKb', 'findingsAboutSourceRepo', 'deviationsFromProposal', 'notBuilt'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['accept', 'revise', 'reject'] },
    checkPassed: { type: 'boolean', description: 'did node tools/check.mjs pass on the folder when you ran it' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'major', 'minor'] },
          where: { type: 'string', description: 'file:line or page element' },
          what: { type: 'string', description: 'the defect, with the wrong value and the right value where applicable' },
          evidence: { type: 'string', description: 'the command, recomputation or citation that shows it' },
          fix: { type: 'string', description: 'what a fixer should do' },
        },
        required: ['severity', 'where', 'what', 'evidence', 'fix'],
      },
    },
    numbersRecomputed: { type: 'array', items: { type: 'string' }, description: 'each load-bearing number you recomputed independently and whether it matched' },
    citationsChecked: { type: 'array', items: { type: 'string' }, description: 'each file:line or claim you opened and whether it held' },
    sabotage: { type: 'string', description: 'what you broke in a /tmp copy and how many tests caught it; or not attempted and why' },
    outsideWrites: { type: 'string', description: 'result of git status in the bank and the three source repos: any change outside the idea folder?' },
  },
  required: ['verdict', 'checkPassed', 'findings', 'numbersRecomputed', 'citationsChecked', 'sabotage', 'outsideWrites'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['fixed', 'partial', 'failed'] },
    addressed: { type: 'array', items: { type: 'string' } },
    notAddressed: { type: 'array', items: { type: 'object', properties: { finding: { type: 'string' }, reason: { type: 'string' } }, required: ['finding', 'reason'] } },
    checkOutput: { type: 'string', description: 'the last lines of node tools/check.mjs for the folder after the fix' },
    readmeTrue: { type: 'boolean', description: 'you re-read the README top to bottom after fixing and every sentence is true for the folder as it now is' },
  },
  required: ['status', 'addressed', 'notAddressed', 'checkOutput', 'readmeTrue'],
}

const folderOf = (idea) => 'ideas/' + idea.no + '-' + idea.slug

function buildPrompt(idea) {
  const folder = folderOf(idea)
  const large = idea.buildEstimate === 'large' || Number(idea.meanBuildable) < 3.5
  return [
    'You are building one deposit for the Aster Idea Bank. FIRST read the builder brief at ' + BUILDER_BRIEF + ' and follow it exactly; it is the contract: house rules, where you may write, the README skeleton the checker enforces, the honesty rules, and how to finish.',
    'Assignment: No. ' + idea.no + ', title "' + idea.title + '", folder ' + BANK + '/' + folder + '/ (create it; write only there), for ' + idea.for + ', surface ' + idea.surface + '.',
    'The judged proposal is at ' + idea.proposal + ' (JSON: pitch, whyNow with citations, computes, dataNeeded, existingOverlap, honestyRisks, testPlan, landing, and the three judges\' notes). Read it in full. Treat it as a brief, not gospel: verify every citation and number against the source repositories before relying on it, keep the honest core, correct or drop claims that do not survive, and record in the README what you changed and why.',
    large
      ? 'The buildability judge flagged this as large. Scope it to what you can build AND prove in one session (a smaller grid, fewer bodies, one mode, a narrower claim). State in the README exactly what you cut and why. Never fake or stub the cut part with placeholder numbers; a smaller honest deposit beats a larger hollow one.'
      : 'Build the whole proposal. Where a part cannot be done honestly with the data in the checkouts, say so in the README rather than faking it.',
    'Quality bar: the two finished Idea Bank deposits the brief names. An independent reviewer who cannot talk to you will next try to prove this deposit wrong: recomputing its numbers, opening its citations, sabotaging the code to see whether the tests notice, opening the page at 390 px in dark mode, and running git status in all four repositories to catch writes outside your folder. Build so that review finds nothing.',
    'Finish per the brief (check.mjs prints "all ideas pass", screenshots inspected, folder under 500 KB, scratch removed, no __pycache__) and return the structured report. Be exact and truthful; "notBuilt" and "deviationsFromProposal" are expected to be non-empty when they should be.',
  ].join('\n')
}

function reviewPrompt(idea, prev, round) {
  const folder = folderOf(idea)
  const lines = [
    'You are the independent reviewer (round ' + round + ') of the Aster Idea Bank deposit at ' + BANK + '/' + folder + '/. FIRST read the reviewer brief at ' + REVIEWER_BRIEF + ' and follow it: you are read-only everywhere; you try to prove the deposit wrong with evidence.',
    'The original judged proposal is at ' + idea.proposal + '. The builder\'s own report (claims to test) follows as JSON:',
    JSON.stringify(prev.built),
  ]
  if (round === 2) {
    lines.push('A first review found the problems below and a fixer then reported what it addressed. Your job now: confirm each blocking and major finding is truly resolved (re-run the evidence), check that the fix introduced no regression (re-run check.mjs, re-open the page, re-read the README for sentences that are no longer true), and look once more for anything the first review missed.')
    lines.push('First review: ' + JSON.stringify(prev.review))
    lines.push('Fixer report: ' + JSON.stringify(prev.fix))
  }
  lines.push('Return the structured verdict. Every finding needs file:line or an element, the wrong and right values where applicable, the evidence, and the fix. Verdict "accept" means you would merge it as is; "revise" means fixable findings; "reject" means a blocking problem that undermines the deposit (a fabricated number, a false central claim, a crash, writes outside the folder).')
  return lines.join('\n')
}

function fixPrompt(idea, review, round) {
  const folder = folderOf(idea)
  return [
    'You are fixing the Aster Idea Bank deposit at ' + BANK + '/' + folder + '/ after independent review round ' + round + '. FIRST read the builder brief at ' + BUILDER_BRIEF + '; it binds you: write only inside this folder, no git state changes, no installs, the README skeleton, the honesty rules, how to finish. Then read every file in the folder and the proposal at ' + idea.proposal + '.',
    'The review findings (JSON):',
    JSON.stringify(review),
    'Address every blocking and major finding, and the minor ones where cheap. If you believe a finding is wrong, do not silently skip it: either add to the README the evidence that shows the original claim is right, or list it under notAddressed with the reason. Fix root causes, not symptoms; if a number was wrong, find out why and check the others that came from the same place.',
    'After fixing: re-run node ' + BANK + '/tools/check.mjs ' + folder + ' until it prints "all ideas pass"; re-read the README top to bottom and make every sentence true for the folder as it now is (update Tests, Honest assessment and any number that changed); confirm the folder is under 500 KB with no scratch files. Return the structured report.',
  ].join('\n')
}

const results = await pipeline(
  ideas,
  (idea) => agent(buildPrompt(idea), { label: 'build:' + idea.no + '-' + idea.slug, phase: 'Build', schema: BUILD_SCHEMA })
    .then((b) => { log(idea.no + ' ' + idea.slug + ': build ' + (b ? b.status : 'no result')); return { idea, built: b } }),
  (prev, idea) => {
    if (!prev.built || prev.built.status !== 'built') return { ...prev, review: null }
    return agent(reviewPrompt(idea, prev, 1), { label: 'review:' + idea.no + '-' + idea.slug, phase: 'Review', schema: REVIEW_SCHEMA })
      .then((r) => { log(idea.no + ' ' + idea.slug + ': review ' + (r ? r.verdict + ' (' + (r.findings || []).length + ' findings)' : 'no result')); return { ...prev, review: r } })
  },
  (prev, idea) => {
    if (!prev.review) return { ...prev, fix: null }
    const findings = prev.review.findings || []
    if (!findings.length && prev.review.verdict === 'accept' && prev.review.checkPassed) return { ...prev, fix: null }
    return agent(fixPrompt(idea, prev.review, 1), { label: 'fix:' + idea.no + '-' + idea.slug, phase: 'Fix', schema: FIX_SCHEMA })
      .then((f) => { log(idea.no + ' ' + idea.slug + ': fix ' + (f ? f.status : 'no result')); return { ...prev, fix: f } })
  },
  (prev, idea) => {
    if (!prev.review || !prev.fix) return prev
    const hadBlocking = prev.review.verdict === 'reject' || (prev.review.findings || []).some((f) => f.severity === 'blocking') || !prev.review.checkPassed
    if (!hadBlocking && prev.fix.status === 'fixed') return prev
    return agent(reviewPrompt(idea, prev, 2), { label: 'review2:' + idea.no + '-' + idea.slug, phase: 'Re-review', schema: REVIEW_SCHEMA })
      .then((r) => { log(idea.no + ' ' + idea.slug + ': re-review ' + (r ? r.verdict + ' (' + (r.findings || []).length + ' findings)' : 'no result')); return { ...prev, review2: r } })
  },
  (prev, idea) => {
    if (!prev.review2) return prev
    const f2 = prev.review2.findings || []
    if (prev.review2.verdict === 'accept' && !f2.some((f) => f.severity !== 'minor')) return prev
    return agent(fixPrompt(idea, prev.review2, 2), { label: 'fix2:' + idea.no + '-' + idea.slug, phase: 'Re-review', schema: FIX_SCHEMA })
      .then((f) => { log(idea.no + ' ' + idea.slug + ': fix2 ' + (f ? f.status : 'no result')); return { ...prev, fix2: f } })
  },
)

const summary = results.map((r, i) => {
  const idea = ideas[i]
  if (!r) return { no: idea.no, slug: idea.slug, status: 'pipeline-dropped' }
  const sev = (rev) => rev ? { verdict: rev.verdict, blocking: (rev.findings || []).filter((f) => f.severity === 'blocking').length, major: (rev.findings || []).filter((f) => f.severity === 'major').length, minor: (rev.findings || []).filter((f) => f.severity === 'minor').length, outsideWrites: rev.outsideWrites } : null
  return {
    no: idea.no, slug: idea.slug, title: idea.title, for: idea.for,
    status: r.built ? r.built.status : 'no-build-result',
    whatItDoes: r.built ? r.built.whatItDoes : '',
    testsPin: r.built ? r.built.testsPin : '',
    findingsAboutSourceRepo: r.built ? r.built.findingsAboutSourceRepo : '',
    deviationsFromProposal: r.built ? r.built.deviationsFromProposal : '',
    notBuilt: r.built ? r.built.notBuilt : '',
    review: sev(r.review),
    fix: r.fix ? { status: r.fix.status, notAddressed: r.fix.notAddressed, readmeTrue: r.fix.readmeTrue } : null,
    review2: sev(r.review2),
    fix2: r.fix2 ? { status: r.fix2.status, notAddressed: r.fix2.notAddressed, readmeTrue: r.fix2.readmeTrue } : null,
    lastCheck: (r.fix2 && r.fix2.checkOutput) || (r.fix && r.fix.checkOutput) || (r.built && r.built.checkOutput) || '',
  }
})
log('Batch done: ' + summary.map((s) => s.no + ' ' + s.slug + ' ' + s.status + (s.review ? '/' + s.review.verdict : '') + (s.review2 ? '/' + s.review2.verdict : '')).join(' · '))
return summary