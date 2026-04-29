# Pump Fee Recipient Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update `pump-trader@1.1.3` so Pump bonding and AMM instructions remain compatible with the April 28, 2026 fee recipient account layout upgrade.

**Architecture:** Keep the existing handwritten instruction builders, add a centralized fee recipient selector, and rebuild the bonding and AMM account arrays so their tail order matches the upgraded programs. Use narrow regression tests that assert exact key ordering and account counts rather than broad network integration tests.

**Tech Stack:** TypeScript, Node.js built-in test runner, `tsx`, `@solana/web3.js`, `@solana/spl-token`

---

### Task 1: Add regression tests for upgraded account layouts

**Files:**
- Modify: `package.json`
- Create: `tests/instruction-accounts.test.ts`

**Step 1: Write the failing test**

Create tests that expect:
- bonding buy has 18 keys and the final two are `bondingCurveV2`, fee recipient
- bonding sell has 16 keys without cashback and 17 with cashback, with fee recipient last
- AMM buy has 26 keys without cashback and 27 with cashback, with `poolV2`, fee recipient, fee recipient quote ATA at the tail
- AMM sell has 24 keys without cashback and 26 with cashback, with the same tail order

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because the new helper methods or expected key layout do not yet exist.

**Step 3: Write minimal implementation**

Add helper methods in `index.ts` that build the account arrays and are reused by the existing transaction builders.

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json tests/instruction-accounts.test.ts index.ts index.js dist docs/plans
git commit -m "fix: support upgraded pump fee recipient accounts"
```

### Task 2: Update bonding instruction account assembly

**Files:**
- Modify: `index.ts`
- Modify: `index.js`
- Modify: `dist/index.js`
- Modify: `dist/index.d.ts`

**Step 1: Write the failing test**

Use the bonding tests from Task 1 as the failing coverage.

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern bonding`
Expected: FAIL because bonding key count and fee recipient tail order are still old.

**Step 3: Write minimal implementation**

Add the 8 fee recipient constants, selector helper, bonding key builders, and switch `buy()` / `sell()` to use them.

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern bonding`
Expected: PASS

**Step 5: Commit**

```bash
git add index.ts index.js dist
git commit -m "fix: update bonding fee recipient accounts"
```

### Task 3: Update AMM instruction account assembly

**Files:**
- Modify: `index.ts`
- Modify: `index.js`
- Modify: `dist/index.js`
- Modify: `dist/index.d.ts`

**Step 1: Write the failing test**

Use the AMM tests from Task 1 as the failing coverage.

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern amm`
Expected: FAIL because the fee recipient pair is still placed before `pool-v2`.

**Step 3: Write minimal implementation**

Make AMM key assembly place `pool-v2` before the new trailing fee recipient pair for both buy and sell, preserving cashback-only extras.

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern amm`
Expected: PASS

**Step 5: Commit**

```bash
git add index.ts index.js dist
git commit -m "fix: update amm fee recipient accounts"
```

### Task 4: Build and verify distributable output

**Files:**
- Modify: `dist/index.js`
- Modify: `dist/index.d.ts`

**Step 1: Write the failing test**

Use the build command as the verification target for generated output drift.

**Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: PASS after source changes, with generated `dist` updated.

**Step 3: Write minimal implementation**

No extra implementation beyond generating `dist`.

**Step 4: Run test to verify it passes**

Run: `npm test && npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add dist
git commit -m "build: refresh distribution output"
```
