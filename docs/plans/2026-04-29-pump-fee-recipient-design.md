# Pump Fee Recipient Upgrade Design

**Context**

`pump-trader@1.1.3` currently hardcodes Pump bonding and AMM instruction account layouts that matched the pre-upgrade programs. Pump announced a breaking account layout change effective on April 28, 2026 at 16:00 UTC. After that upgrade, the existing instruction builders send the wrong account count and wrong trailing account order.

**Design**

Use a compatibility patch inside the existing handwritten instruction builders instead of migrating the project to the official SDKs. The patch adds the 8 published fee recipient addresses as constants, centralizes fee recipient selection behind a small helper, and updates the trailing account order for both bonding and AMM flows.

For bonding:
- append one mutable fee recipient after `bonding-curve-v2`
- keep all existing accounts before `bonding-curve-v2` unchanged

For AMM:
- keep existing accounts through `pool-v2`
- move the fee recipient pair to the end
- pass fee recipient as readonly
- pass quote mint ATA for that recipient as mutable

**Why This Approach**

This is the smallest change that restores runtime compatibility while preserving the library's current API and handwritten transaction flow. It also gives one future extension point for recipient selection without forcing an SDK dependency or wider refactor.

**Validation**

Add regression tests that assert instruction key count and tail ordering for:
- bonding buy
- bonding sell without cashback
- bonding sell with cashback
- AMM buy without cashback
- AMM buy with cashback
- AMM sell without cashback
- AMM sell with cashback
